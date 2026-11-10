import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

export interface AppConfig {
  telegram: {
    botToken: string;
    allowedChatIds?: number[];
  };
  github: {
    token: string;
    owner: string;
    repo: string;
  };
  worker: {
    model: string;
    mode: "plan" | "auto";
  };
  storage: {
    dataDir: string;
    /** 체크포인트 이하(이슈화분) 중 최근 N개는 답장 재요약용으로 유지 */
    keepBelowCheckpointCount: number;
    /** 체크포인트 이하 중 최근 N일 이내도 유지 (개수 버퍼와 합집합) */
    keepBelowCheckpointDays: number;
    /** 전체 메시지 상한. 초과 시 이슈화분만 추가 축소 (미요약은 유지) */
    maxTotalMessages: number;
    /** saveMessage N회마다 보조 prune 점검 */
    pruneEveryNSaves: number;
  };
}

export const config: AppConfig = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    allowedChatIds: process.env.ALLOWED_CHAT_IDS
      ? process.env.ALLOWED_CHAT_IDS.split(",").map((id) => Number(id.trim()))
      : undefined,
  },
  github: {
    token: process.env.GITHUB_TOKEN || "",
    owner: process.env.GITHUB_OWNER || "",
    repo: process.env.GITHUB_REPO || "",
  },
  worker: {
    model: process.env.WORKER_MODEL || "gemini-3.8-flash-low",
    mode: (process.env.WORKER_MODE as "plan" | "auto") || "plan",
  },
  storage: {
    dataDir: path.resolve(process.cwd(), "data"),
    keepBelowCheckpointCount: 200,
    keepBelowCheckpointDays: 7,
    maxTotalMessages: 5000,
    pruneEveryNSaves: 50,
  },
};
