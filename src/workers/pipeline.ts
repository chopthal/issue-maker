import { settingsManager } from "../storage/settings.js";
import { runAgy } from "./agyWorker.js";
import { runCursor } from "./cursorWorker.js";
import { runOpenAI } from "./openaiWorker.js";
import { ONESHOT_ISSUE_SYNTHESIZER_PROMPT } from "./prompts.js";

export interface SynthesizedIssue {
  title: string;
  body: string;
  rawOutput: string;
}

export interface PipelineResult {
  issue: SynthesizedIssue;
  processingTimeMs: number;
  engine: string;
  model: string;
  effort?: string;
}

export async function runSynthesisPipeline(
  rawConversation: string,
  onProgress?: (step: string) => void
): Promise<PipelineResult> {
  const startTime = Date.now();
  const settings = settingsManager.getSettings();
  const engine = settings.engine;
  const model = settings.model;
  const mode = settings.mode;
  const effort = settings.effort;

  const effortDesc = engine === "agy" ? ` (effort: ${effort})` : "";
  onProgress?.(`[${engine.toUpperCase()}] ${model}${effortDesc} 모델로 대화 분석 및 GitHub Issue 생성 중...`);

  const fullPrompt = `${ONESHOT_ISSUE_SYNTHESIZER_PROMPT}\n\n[정제할 대화 내용 원본]\n${rawConversation}\n\n위 대화를 분석하여 양식에 맞추어 완성형 GitHub Issue를 작성해주세요. 반드시 첫 줄에 '# TITLE: [타입] 제목' 형식으로 제목을 포함해야 합니다.`;

  let rawOutput = "";

  if (engine === "agy") {
    rawOutput = await runAgy(fullPrompt, model, mode, effort);
  } else if (engine === "openai") {
    rawOutput = await runOpenAI(fullPrompt, model);
  } else {
    // cursor
    rawOutput = await runCursor(fullPrompt, model, mode);
  }

  const issue = parseIssueOutput(rawOutput, rawConversation);
  const processingTimeMs = Date.now() - startTime;

  return {
    issue,
    processingTimeMs,
    engine,
    model,
    effort,
  };
}

function parseIssueOutput(raw: string, fallbackBody: string): SynthesizedIssue {
  const lines = raw.split("\n");
  let title = "[Feature] 기획-개발 논의 이슈";
  let bodyStartIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("# TITLE:") || line.startsWith("TITLE:")) {
      title = line.replace(/#?\s*TITLE:\s*/i, "").trim();
      bodyStartIndex = i + 1;
      break;
    } else if (line.startsWith("# [") || line.startsWith("# Feature") || line.startsWith("# [Feature]")) {
      title = line.replace(/^#\s*/, "").trim();
      bodyStartIndex = i + 1;
      break;
    }
  }

  const body = lines.slice(bodyStartIndex).join("\n").trim();

  return {
    title: title || "[Spec] 기획-개발 논의 이슈",
    body: body || fallbackBody,
    rawOutput: raw,
  };
}
