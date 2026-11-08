import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

export type WorkerEngine = "agy" | "cursor" | "openai";

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
  openai: {
    apiKey: string;
    baseUrl?: string;
  };
  worker: {
    engine: WorkerEngine;
    model: string;
    mode: "plan" | "auto";
  };
  storage: {
    dataDir: string;
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
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  },
  worker: {
    engine: (process.env.WORKER_ENGINE as WorkerEngine) || "agy",
    model: process.env.WORKER_MODEL || "gemini-3.8-flash-low",
    mode: (process.env.WORKER_MODE as "plan" | "auto") || "plan",
  },
  storage: {
    dataDir: path.resolve(process.cwd(), "data"),
  },
};
