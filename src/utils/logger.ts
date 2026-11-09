import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { config } from "../config.js";

export class Logger {
  private logFile: string;
  private maxLines: number;
  private isHooked = false;
  private writeCount = 0;

  constructor(maxLines = 2000) {
    this.logFile = path.join(config.storage.dataDir, "bot.log");
    this.maxLines = maxLines;
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(config.storage.dataDir)) {
      fs.mkdirSync(config.storage.dataDir, { recursive: true });
    }
  }

  private getTimestamp(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const year = now.getFullYear();
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());
    const hours = pad(now.getHours());
    const minutes = pad(now.getMinutes());
    const seconds = pad(now.getSeconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * 로그 파일이 maxLines(기본 2000줄)를 초과하면 오래된 앞쪽 라인을 잘라내어 일정 크기로 유지 (Rolling Buffer)
   */
  public truncateIfNeeded(force = false): void {
    this.writeCount++;
    if (!force && this.writeCount % 50 !== 0) {
      return;
    }

    try {
      if (!fs.existsSync(this.logFile)) return;
      const content = fs.readFileSync(this.logFile, "utf-8");
      const lines = content.split("\n");
      if (lines.length > this.maxLines) {
        // 최근 maxLines 줄만 남기고 앞부분 절삭
        const keptLines = lines.slice(lines.length - this.maxLines);
        fs.writeFileSync(this.logFile, keptLines.join("\n"), "utf-8");
      }
    } catch {
      // 로깅 자르기 실패 시 무시
    }
  }

  private formatLog(level: "INFO" | "WARN" | "ERROR", ...args: any[]): string {
    const timestamp = this.getTimestamp();
    const formatted = util.format(...args);
    const lines = formatted.split("\n");
    return lines.map((line) => `[${timestamp}] [${level}] ${line}`).join("\n");
  }

  public info(message: string, ...args: any[]): void {
    console.log(message, ...args);
  }

  public warn(message: string, ...args: any[]): void {
    console.warn(message, ...args);
  }

  public error(message: string, ...args: any[]): void {
    console.error(message, ...args);
  }

  /**
   * Node.js 전역 console.log, console.error, console.warn 을 가로채서
   * 타임스탬프와 파일 롤링을 자동으로 적용
   */
  public hookGlobalConsole(): void {
    if (this.isHooked) return;
    this.isHooked = true;

    // 시작 시 기존 로그 파일 롤링 점검
    this.truncateIfNeeded(true);

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args: any[]) => {
      const text = this.formatLog("INFO", ...args);
      originalLog(text);
      try {
        this.ensureDirectory();
        fs.appendFileSync(this.logFile, text + "\n", "utf-8");
        this.truncateIfNeeded();
      } catch {}
    };

    console.warn = (...args: any[]) => {
      const text = this.formatLog("WARN", ...args);
      originalWarn(text);
      try {
        this.ensureDirectory();
        fs.appendFileSync(this.logFile, text + "\n", "utf-8");
        this.truncateIfNeeded();
      } catch {}
    };

    console.error = (...args: any[]) => {
      const text = this.formatLog("ERROR", ...args);
      originalError(text);
      try {
        this.ensureDirectory();
        fs.appendFileSync(this.logFile, text + "\n", "utf-8");
        this.truncateIfNeeded();
      } catch {}
    };

    // 잡히지 않은 예외 및 Promise 거부 처리
    process.on("uncaughtException", (err) => {
      const text = this.formatLog("ERROR", "Uncaught Exception:", err);
      originalError(text);
      try {
        this.ensureDirectory();
        fs.appendFileSync(this.logFile, text + "\n", "utf-8");
      } catch {}
      process.exit(1);
    });

    process.on("unhandledRejection", (reason) => {
      const text = this.formatLog("ERROR", "Unhandled Rejection:", reason);
      originalError(text);
      try {
        this.ensureDirectory();
        fs.appendFileSync(this.logFile, text + "\n", "utf-8");
      } catch {}
    });
  }
}

export const logger = new Logger(2000);
