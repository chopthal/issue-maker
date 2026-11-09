import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export interface LastIssueRecord {
  title: string;
  issueNumber?: number;
  issueUrl?: string;
  localSavedPath?: string;
  model: string;
  createdAt: string;
}

export class LastIssueStore {
  private filePath: string;

  constructor() {
    this.filePath = path.join(config.storage.dataDir, "last_issues.json");
    this.ensureFile();
  }

  private ensureFile(): void {
    if (!fs.existsSync(config.storage.dataDir)) {
      fs.mkdirSync(config.storage.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({}, null, 2), "utf-8");
    }
  }

  private readAll(): Record<string, LastIssueRecord> {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as Record<string, LastIssueRecord>;
    } catch {
      return {};
    }
  }

  private writeAll(data: Record<string, LastIssueRecord>): void {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  public save(chatId: number, record: LastIssueRecord): void {
    const all = this.readAll();
    all[String(chatId)] = record;
    this.writeAll(all);
  }

  public get(chatId: number): LastIssueRecord | undefined {
    return this.readAll()[String(chatId)];
  }
}

export const lastIssueStore = new LastIssueStore();
