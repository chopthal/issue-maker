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
  },
};
