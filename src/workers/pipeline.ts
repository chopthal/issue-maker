import { settingsManager } from "../storage/settings.js";
import { runAgy } from "./agyWorker.js";
import { ONESHOT_ISSUE_SYNTHESIZER_PROMPT } from "./prompts.js";
import { throwIfAborted } from "../runtime/jobManager.js";

export interface SynthesizedIssue {
  title: string;
  body: string;
  rawOutput: string;
}

export interface PipelineResult {
  issue: SynthesizedIssue;
  processingTimeMs: number;
  model: string;
}

export interface PipelineImageRef {
  messageId: number;
  localPath: string;
}

export async function runSynthesisPipeline(
  rawConversation: string,
  onProgress?: (step: string) => void,
  images: PipelineImageRef[] = [],
  signal?: AbortSignal
): Promise<PipelineResult> {
  const startTime = Date.now();
  const settings = settingsManager.getSettings();
  const model = settings.model;
  const mode = settings.mode;

  throwIfAborted(signal);
  onProgress?.(`[AGY] ${model} 모델로 대화 분석 및 GitHub Issue 생성 중...`);

  let imageSection = "";
  if (images.length > 0) {
    const lines = images.map((img) => `- 메시지 #${img.messageId}: ${img.localPath}`);
    imageSection =
      `\n\n[첨부 사진 파일 — vision으로 직접 확인]\n` +
      `${lines.join("\n")}\n` +
      `위 사진들을 확인하고 UI/화면/도식 내용을 '첨부 미디어 맥락'에 짧게 텍스트로만 요약하세요. ` +
      `대화에 없는 스펙을 추론·보강하지 마세요. ` +
      `GitHub Issue 본문에는 이미지 링크/첨부를 넣지 말고 텍스트 설명만 작성하세요.`;
  }

  const fullPrompt =
    `${ONESHOT_ISSUE_SYNTHESIZER_PROMPT}\n\n` +
    `[대화 내용 원본]\n${rawConversation}` +
    `${imageSection}\n\n` +
    `위 대화를 분석하되, 창작·과도한 구체화 없이 양식에 맞춰 Issue를 작성하세요. ` +
    `원문 의미를 보존하고, 이미지/문서는 맥락 설명만 추가하세요. ` +
    `사전 계획 설명이나 진행 여부 질문을 하지 말고, 반드시 첫 줄에 '# TITLE: [타입] 제목' 형식으로 시작하여 본문 전체를 원샷으로 출력해야 합니다.`;

  const rawOutput = await runAgy(
    fullPrompt,
    model,
    mode,
    images.map((img) => img.localPath),
    signal
  );

  throwIfAborted(signal);

  const issue = parseIssueOutput(rawOutput, rawConversation);
  const processingTimeMs = Date.now() - startTime;

  return {
    issue,
    processingTimeMs,
    model,
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
    } else if (
      line.startsWith("# [") ||
      line.startsWith("# Feature") ||
      line.startsWith("# [Feature]")
    ) {
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
