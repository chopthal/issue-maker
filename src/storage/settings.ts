import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export interface RuntimeWorkerSettings {
  model: string;
  mode: "plan" | "auto";
}

export class SettingsManager {
  /** AGY 공식 모델 목록 (effort 접미사 포함) */
  public static readonly MODELS: string[] = [
    "gemini-3.8-flash-low",
    "gemini-3.8-flash-medium",
    "gemini-3.8-flash-high",
    "gemini-4-argon-low",
    "gemini-4-argon-medium",
    "gemini-4-argon-high",
  ];

  public static readonly DEFAULT_MODEL = "gemini-3.8-flash-low";

  private settingsFile: string;
  private currentSettings: RuntimeWorkerSettings;

  constructor() {
    this.settingsFile = path.join(config.storage.dataDir, "runtime_settings.json");
    this.currentSettings = this.loadSettings();
  }

  private loadSettings(): RuntimeWorkerSettings {
    const defaultSettings: RuntimeWorkerSettings = {
      model: config.worker.model || SettingsManager.DEFAULT_MODEL,
      mode: config.worker.mode || "plan",
    };

    try {
      if (fs.existsSync(this.settingsFile)) {
        const raw = fs.readFileSync(this.settingsFile, "utf-8");
        const parsed = JSON.parse(raw);
        const model =
          typeof parsed.model === "string" && parsed.model.trim()
            ? parsed.model.trim()
            : defaultSettings.model;
        const mode = parsed.mode === "auto" || parsed.mode === "plan" ? parsed.mode : defaultSettings.mode;
        return { model, mode };
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

  public setModel(model: string): RuntimeWorkerSettings {
    this.currentSettings.model = model.trim();
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
