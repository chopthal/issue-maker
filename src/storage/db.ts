import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export type MediaKind = "photo" | "document" | "voice" | "other";

export interface ChatMessage {
  id: number;
  chatId: number;
  sender: string;
  senderId: number;
  date: string;
  text: string;
  replyToMessageId?: number;
  /** 다른 방에서 전달(forward)된 메시지 — sender/date는 원 작성자·원 작성 시각 */
  isForwarded?: boolean;
  hasMedia?: boolean;
  mediaKind?: MediaKind;
  /** Telegram file_id — 요약 시 임시 다운로드용 (로컬 영구 저장 없음) */
  telegramFileId?: string;
  fileName?: string;
  caption?: string;
}

export interface ChatState {
  lastCheckpointMessageId: number;
  lastCheckpointTime?: string;
}

export interface PruneResult {
  removed: number;
  remaining: number;
}

/**
 * 저장된 date 문자열을 epoch ms로 파싱.
 * ISO/일반 파싱 실패 시 ko-KR 로케일 형태(YYYY. M. D.)만이라도 일자 단위로 복원.
 */
export function parseMessageDate(dateStr: string): number | null {
  if (!dateStr) return null;

  const direct = Date.parse(dateStr);
  if (!Number.isNaN(direct)) return direct;

  const match = dateStr.match(
    /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(오전|오후)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  let hour = match[5] ? Number(match[5]) : 0;
  const minute = match[6] ? Number(match[6]) : 0;
  const second = match[7] ? Number(match[7]) : 0;
  const ampm = match[4];

  if (ampm === "오후" && hour < 12) hour += 12;
  if (ampm === "오전" && hour === 12) hour = 0;

  const ms = Date.parse(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}+09:00`
  );
  return Number.isNaN(ms) ? null : ms;
}

export class MessageStore {
  private dataDir: string;
  private messagesFile: string;
  private stateFile: string;
  private excludesFile: string;
  private saveCount = 0;

  constructor() {
    this.dataDir = config.storage.dataDir;
    this.messagesFile = path.join(this.dataDir, "messages.json");
    this.stateFile = path.join(this.dataDir, "checkpoints.json");
    this.excludesFile = path.join(this.dataDir, "excludes.json");

    this.initDirectories();
  }

  private initDirectories(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.messagesFile)) {
      fs.writeFileSync(this.messagesFile, JSON.stringify([], null, 2), "utf-8");
    }
    if (!fs.existsSync(this.stateFile)) {
      fs.writeFileSync(this.stateFile, JSON.stringify({}, null, 2), "utf-8");
    }
    if (!fs.existsSync(this.excludesFile)) {
      fs.writeFileSync(this.excludesFile, JSON.stringify({}, null, 2), "utf-8");
    }
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
    const exists = messages.some((m) => m.chatId === message.chatId && m.id === message.id);
    if (!exists) {
      messages.push(message);
      this.writeAllMessages(messages);
      this.saveCount++;
      if (this.saveCount % config.storage.pruneEveryNSaves === 0) {
        this.pruneMessages();
      }
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

  private readAllExcludes(): Record<string, number[]> {
    try {
      const data = fs.readFileSync(this.excludesFile, "utf-8");
      const parsed = JSON.parse(data) as Record<string, unknown>;
      const result: Record<string, number[]> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (!Array.isArray(value)) continue;
        result[key] = value
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
          .sort((a, b) => a - b);
      }
      return result;
    } catch {
      return {};
    }
  }

  private writeAllExcludes(excludes: Record<string, number[]>): void {
    fs.writeFileSync(this.excludesFile, JSON.stringify(excludes, null, 2), "utf-8");
  }

  /** 채팅별 제외 메시지 ID 목록 (오름차순) */
  public getExcludedMessageIds(chatId: number): number[] {
    return this.readAllExcludes()[chatId.toString()] || [];
  }

  /**
   * 제외 목록 토글.
   * 이미 있으면 제거하고, 없으면 추가한다.
   */
  public toggleExclude(chatId: number, messageId: number): { added: boolean; ids: number[] } {
    const all = this.readAllExcludes();
    const key = chatId.toString();
    const current = new Set(all[key] || []);
    let added = false;

    if (current.has(messageId)) {
      current.delete(messageId);
    } else {
      current.add(messageId);
      added = true;
    }

    const ids = [...current].sort((a, b) => a - b);
    if (ids.length === 0) {
      delete all[key];
    } else {
      all[key] = ids;
    }
    this.writeAllExcludes(all);
    return { added, ids };
  }

  public clearExcludes(chatId: number): number {
    const all = this.readAllExcludes();
    const key = chatId.toString();
    const removed = all[key]?.length || 0;
    if (removed > 0) {
      delete all[key];
      this.writeAllExcludes(all);
    }
    return removed;
  }

  /**
   * 이슈화된(checkpoint 이하) 오래된 메시지만 제거.
   * 미요약(id > checkpoint)은 개수/일수와 무관하게 유지한다.
   */
  public pruneMessages(chatId?: number): PruneResult {
    const all = this.readAllMessages();
    const checkpoints = this.readAllCheckpoints();
    const before = all.length;
    const now = Date.now();

    const chatIds =
      chatId !== undefined
        ? [chatId]
        : [
            ...new Set([
              ...all.map((m) => m.chatId),
              ...Object.keys(checkpoints).map((k) => Number(k)),
            ]),
          ];

    const keptByChat = new Map<number, ChatMessage[]>();
    for (const id of chatIds) {
      const checkpoint = checkpoints[id.toString()]?.lastCheckpointMessageId || 0;
      const chatMessages = all.filter((m) => m.chatId === id);
      keptByChat.set(id, this.selectMessagesToKeep(chatMessages, checkpoint, now));
    }

    // prune 대상이 아닌 채팅방 메시지도 보존
    const prunedChatIdSet = new Set(chatIds);
    const untouched = all.filter((m) => !prunedChatIdSet.has(m.chatId));

    let next = [...untouched, ...[...keptByChat.values()].flat()];

    next = this.enforceGlobalCap(next, checkpoints);

    // 안정적인 순서로 저장
    next.sort((a, b) => a.chatId - b.chatId || a.id - b.id);

    if (next.length !== before) {
      this.writeAllMessages(next);
    }

    return { removed: before - next.length, remaining: next.length };
  }

  private selectMessagesToKeep(
    chatMessages: ChatMessage[],
    checkpoint: number,
    nowMs: number
  ): ChatMessage[] {
    if (chatMessages.length === 0) return [];

    const pending = chatMessages.filter((m) => m.id > checkpoint);
    const summarized = chatMessages
      .filter((m) => m.id <= checkpoint)
      .sort((a, b) => a.id - b.id);

    if (checkpoint <= 0 || summarized.length === 0) {
      return [...summarized, ...pending].sort((a, b) => a.id - b.id);
    }

    const keepIds = new Set<number>();
    const countKeep = config.storage.keepBelowCheckpointCount;
    const dayKeepMs = config.storage.keepBelowCheckpointDays * 24 * 60 * 60 * 1000;
    const dayThreshold = nowMs - dayKeepMs;

    // 최근 N개 (id 기준)
    for (const m of summarized.slice(-countKeep)) {
      keepIds.add(m.id);
    }

    // 최근 N일 (파싱 가능한 날짜만)
    for (const m of summarized) {
      const ts = parseMessageDate(m.date);
      if (ts !== null && ts >= dayThreshold) {
        keepIds.add(m.id);
      }
    }

    const keptSummarized = summarized.filter((m) => keepIds.has(m.id));
    return [...keptSummarized, ...pending].sort((a, b) => a.id - b.id);
  }

  /**
   * 전역 상한 초과 시 이슈화분(id <= checkpoint)만 오래된 것부터 추가 삭제.
   * 미요약은 상한을 넘더라도 삭제하지 않는다.
   */
  private enforceGlobalCap(
    messages: ChatMessage[],
    checkpoints: Record<string, ChatState>
  ): ChatMessage[] {
    const maxTotal = config.storage.maxTotalMessages;
    if (messages.length <= maxTotal) return messages;

    const removable = messages
      .filter((m) => {
        const checkpoint = checkpoints[m.chatId.toString()]?.lastCheckpointMessageId || 0;
        return checkpoint > 0 && m.id <= checkpoint;
      })
      .sort((a, b) => {
        const ta = parseMessageDate(a.date);
        const tb = parseMessageDate(b.date);
        if (ta !== null && tb !== null && ta !== tb) return ta - tb;
        return a.chatId - b.chatId || a.id - b.id;
      });

    const removeKeys = new Set<string>();
    let overflow = messages.length - maxTotal;
    for (const m of removable) {
      if (overflow <= 0) break;
      removeKeys.add(`${m.chatId}:${m.id}`);
      overflow--;
    }

    if (removeKeys.size === 0) return messages;
    return messages.filter((m) => !removeKeys.has(`${m.chatId}:${m.id}`));
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
        let content = m.text || m.caption || "";
        if (m.hasMedia) {
          if (m.mediaKind === "photo") {
            content += ` [사진 첨부${m.caption ? ` / 캡션: ${m.caption}` : ""} — 별도 이미지 파일로 전달됨]`;
          } else if (m.mediaKind === "document") {
            content += ` [문서 첨부: ${m.fileName || "파일"} — 모델 분석 대상 아님, 필요 시 직접 전달]`;
          } else if (m.mediaKind === "voice") {
            content += ` [음성 첨부 — 모델 분석 대상 아님, 필요 시 직접 전달]`;
          } else {
            content += ` [미디어 첨부 — 모델 분석 대상 아님]`;
          }
        }
        return `[#${m.id} | ${m.date}] ${m.sender}: ${content}`;
      })
      .join("\n");
  }
}

export const store = new MessageStore();
