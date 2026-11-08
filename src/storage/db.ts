import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export interface ChatMessage {
  id: number;
  chatId: number;
  sender: string;
  senderId: number;
  date: string;
  text: string;
  replyToMessageId?: number;
  hasMedia?: boolean;
  mediaPath?: string;
  caption?: string;
}

export interface ChatState {
  lastCheckpointMessageId: number;
  lastCheckpointTime?: string;
}

export class MessageStore {
  private dataDir: string;
  private messagesFile: string;
  private stateFile: string;
  private mediaDir: string;

  constructor() {
    this.dataDir = config.storage.dataDir;
    this.messagesFile = path.join(this.dataDir, "messages.json");
    this.stateFile = path.join(this.dataDir, "checkpoints.json");
    this.mediaDir = path.join(this.dataDir, "media");

    this.initDirectories();
  }

  private initDirectories(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.mediaDir)) {
      fs.mkdirSync(this.mediaDir, { recursive: true });
    }
    if (!fs.existsSync(this.messagesFile)) {
      fs.writeFileSync(this.messagesFile, JSON.stringify([], null, 2), "utf-8");
    }
    if (!fs.existsSync(this.stateFile)) {
      fs.writeFileSync(this.stateFile, JSON.stringify({}, null, 2), "utf-8");
    }
  }

  public getMediaDir(): string {
    return this.mediaDir;
  }

  private readAllMessages(): ChatMessage[] {
    try {
      const data = fs.readFileSync(this.messagesFile, "utf-8");
      return JSON.parse(data) as ChatMessage[];
    } catch {
      return [];
    }
  }

  private writeAllMessages(messages: ChatMessage[]): void {
    fs.writeFileSync(this.messagesFile, JSON.stringify(messages, null, 2), "utf-8");
  }

  private readAllCheckpoints(): Record<string, ChatState> {
    try {
      const data = fs.readFileSync(this.stateFile, "utf-8");
      return JSON.parse(data) as Record<string, ChatState>;
    } catch {
      return {};
    }
  }

  private writeAllCheckpoints(states: Record<string, ChatState>): void {
    fs.writeFileSync(this.stateFile, JSON.stringify(states, null, 2), "utf-8");
  }

  public saveMessage(message: ChatMessage): void {
    const messages = this.readAllMessages();
    // 중복 방지
    const exists = messages.some((m) => m.chatId === message.chatId && m.id === message.id);
    if (!exists) {
      messages.push(message);
      this.writeAllMessages(messages);
    }
  }

  public getCheckpoint(chatId: number): number {
    const states = this.readAllCheckpoints();
    return states[chatId.toString()]?.lastCheckpointMessageId || 0;
  }

  public setCheckpoint(chatId: number, messageId: number): void {
    const states = this.readAllCheckpoints();
    states[chatId.toString()] = {
      lastCheckpointMessageId: messageId,
      lastCheckpointTime: new Date().toISOString(),
    };
    this.writeAllCheckpoints(states);
  }

  /**
   * 대화 범위 수집
   * 1. replyToMessageId가 주어진 경우: 해당 메시지 ID부터 현재 targetMessageId까지 수집
   * 2. replyToMessageId가 없는 경우: 마지막 워터마크(체크포인트) 이후부터 targetMessageId까지 수집
   */
  public getMessagesForSummary(
    chatId: number,
    targetMessageId: number,
    replyToMessageId?: number
  ): { messages: ChatMessage[]; fromMessageId: number; mode: "reply" | "checkpoint" } {
    const all = this.readAllMessages().filter((m) => m.chatId === chatId);

    let fromMessageId = 0;
    let mode: "reply" | "checkpoint" = "checkpoint";

    if (replyToMessageId && replyToMessageId > 0) {
      fromMessageId = replyToMessageId;
      mode = "reply";
    } else {
      fromMessageId = this.getCheckpoint(chatId);
      mode = "checkpoint";
    }

    const filtered = all
      .filter((m) => {
        if (mode === "reply") {
          return m.id >= fromMessageId && m.id < targetMessageId;
        } else {
          return m.id > fromMessageId && m.id < targetMessageId;
        }
      })
      .sort((a, b) => a.id - b.id);

    return {
      messages: filtered,
      fromMessageId,
      mode,
    };
  }

  public formatMessagesForPrompt(messages: ChatMessage[]): string {
    if (messages.length === 0) {
      return "(대화 내용 없음)";
    }

    return messages
      .map((m) => {
        let content = m.text;
        if (m.hasMedia) {
          content += ` [첨부파일: ${m.mediaPath ? path.basename(m.mediaPath) : "미디어"} ${m.caption ? `(설명: ${m.caption})` : ""}]`;
        }
        return `[#${m.id} | ${m.date}] ${m.sender}: ${content}`;
      })
      .join("\n");
  }
}

export const store = new MessageStore();
