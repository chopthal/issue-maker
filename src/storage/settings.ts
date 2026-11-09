import fs from "node:fs";
import path from "node:path";
import { config, WorkerEngine } from "../config.js";

export interface RuntimeWorkerSettings {
  engine: WorkerEngine;
  model: string;
  mode: "plan" | "auto";
  effort: "low" | "medium" | "high" | "xhigh" | "max";
}

export class SettingsManager {
  private settingsFile: string;
  private currentSettings: RuntimeWorkerSettings;

  // 추천 프리셋 정의
  public static readonly PRESETS: Record<WorkerEngine, { models: string[]; defaultModel: string }> = {
    agy: {
      defaultModel: "gemini-3.8-flash-low",
      models: [
        "gemini-3.8-flash-low",
        "gemini-3.8-flash-medium",
        "gemini-3.8-flash-high",
        "gemini-4-argon-low",
        "gemini-4-argon-medium",
        "claude-sonnet-5-5-medium",
      ],
    },
    cursor: {
      defaultModel: "auto",
      models: [
        "auto",
        "deepseek-v41-flash-1017-medium",
        "gpt-5.6-luna-medium",
        "claude-sonnet-5-5-medium",
      ],
    },
    openai: {
      defaultModel: "gpt-6-luna",
      models: [
        "gpt-6-luna",
        "gpt-5-mini",
        "o3-mini",
        "gpt-4o",
      ],
    },
  };

  constructor() {
    this.settingsFile = path.join(config.storage.dataDir, "runtime_settings.json");
    this.currentSettings = this.loadSettings();
  }

  private loadSettings(): RuntimeWorkerSettings {
    const defaultSettings: RuntimeWorkerSettings = {
      engine: config.worker.engine,
      model: config.worker.model,
      mode: config.worker.mode,
      effort: "low",
    };

    try {
      if (fs.existsSync(this.settingsFile)) {
        const raw = fs.readFileSync(this.settingsFile, "utf-8");
        const parsed = JSON.parse(raw);
        return {
          ...defaultSettings,
          ...parsed,
        };
      }
    } catch (err) {
      console.warn("⚠️ Failed to load runtime_settings.json, using defaults:", err);
    }

    return defaultSettings;
  }

  private saveSettings(): void {
    try {
      if (!fs.existsSync(config.storage.dataDir)) {
        fs.mkdirSync(config.storage.dataDir, { recursive: true });
      }
      fs.writeFileSync(this.settingsFile, JSON.stringify(this.currentSettings, null, 2), "utf-8");
    } catch (err) {
      console.error("❌ Failed to save runtime_settings.json:", err);
    }
  }

  public getSettings(): RuntimeWorkerSettings {
    return { ...this.currentSettings };
  }

  public setEngine(engine: WorkerEngine, model?: string): RuntimeWorkerSettings {
    this.currentSettings.engine = engine;
    if (model) {
      this.currentSettings.model = model;
    } else {
      // 해당 엔진의 기본 권장 모델로 자동 전환
      this.currentSettings.model = SettingsManager.PRESETS[engine]?.defaultModel || "auto";
    }
    this.saveSettings();
    return this.getSettings();
  }

  public setModel(model: string): RuntimeWorkerSettings {
    this.currentSettings.model = model.trim();
    this.saveSettings();
    return this.getSettings();
  }

  public setEffort(effort: "low" | "medium" | "high" | "xhigh" | "max"): RuntimeWorkerSettings {
    this.currentSettings.effort = effort;
    this.saveSettings();
    return this.getSettings();
  }

  public setMode(mode: "plan" | "auto"): RuntimeWorkerSettings {
    this.currentSettings.mode = mode;
    this.saveSettings();
    return this.getSettings();
  }
}

export const settingsManager = new SettingsManager();
