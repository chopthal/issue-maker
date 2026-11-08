import { Bot, Context } from "grammy";
import path from "node:path";
import fs from "node:fs";
import { store, ChatMessage } from "../storage/db.js";
import { runSynthesisPipeline } from "../workers/pipeline.js";
import { createGitHubIssue } from "../github/issueCreator.js";
import { config } from "../config.js";

export function registerHandlers(bot: Bot) {
  // 1. 도움말
  bot.command(["start", "help", "도움말"], async (ctx) => {
    await ctx.reply(
      `👋 **Issue-Maker 봇에 오신 것을 환영합니다!**\n\n` +
        `기획자와 개발자가 편하게 대화를 나누시면, AI 워커(DeepSeek Flash + Cursor Auto)가 개발 가능한 GitHub Issue로 자동 정리해 드립니다.\n\n` +
        `📌 **사용 방법**:\n` +
        `• \`/정리\` 또는 대화 중 "여기까지 정리": 직전 정리 시점(체크포인트) 이후의 대화를 자동 정리\n` +
        `• **특정 메시지에 답장으로 \`/정리\`**: 해당 메시지부터 현재까지 지정 구간 정리\n` +
        `• \`/체크포인트\`: 현재 워터마크 상태 확인\n` +
        `• \`/체크포인트초기화\`: 워터마크를 처음으로 리셋`,
      { parse_mode: "Markdown" }
    );
  });

  // 2. 체크포인트 확인/리셋
  bot.command("체크포인트", async (ctx) => {
    const cp = store.getCheckpoint(ctx.chat.id);
    await ctx.reply(`📍 현재 저장된 마지막 체크포인트 메시지 ID: #${cp || "없음(처음부터)"}`);
  });

  bot.command("체크포인트초기화", async (ctx) => {
    store.setCheckpoint(ctx.chat.id, 0);
    await ctx.reply("🔄 체크포인트가 초기화되었습니다. 다음 /정리 시 전체 대화가 대상이 됩니다.");
  });

  // 3. 정리 트리거 핸들러 (/정리, /summary, 또는 텍스트 내 트리거 감지)
  const triggerWords = ["/정리", "/summary", "여기까지 정리", "여기까지정리"];

  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text.trim();
    const isTrigger = triggerWords.some((w) => text.startsWith(w) || text === w);

    if (isTrigger) {
      await handleSummarize(ctx);
      return;
    }

    // 일반 텍스트 메시지 저장
    await saveIncomingMessage(ctx);
    await next();
  });

  // 4. 미디어 메시지 수신 (사진, 문서 등)
  bot.on(["message:photo", "message:document", "message:voice"], async (ctx, next) => {
    const caption = ctx.message.caption || "";
    const isTrigger = triggerWords.some((w) => caption.startsWith(w) || caption === w);

    if (isTrigger) {
      await handleSummarize(ctx);
      return;
    }

    await saveIncomingMessage(ctx);
    await next();
  });
}

async function saveIncomingMessage(ctx: Context) {
  if (!ctx.message || !ctx.chat) return;

  const msg = ctx.message;
  const sender =
    msg.from?.first_name ||
    msg.from?.username ||
    `User_${msg.from?.id || "unknown"}`;

  let mediaPath: string | undefined = undefined;
  let hasMedia = false;

  // 사진/문서 다운로드 처리
  try {
    if (msg.photo && msg.photo.length > 0) {
      hasMedia = true;
      const largest = msg.photo[msg.photo.length - 1];
      const file = await ctx.api.getFile(largest.file_id);
      if (file.file_path) {
        const dest = path.join(store.getMediaDir(), `${msg.message_id}_${path.basename(file.file_path)}`);
        await downloadTelegramFile(file.file_path, dest);
        mediaPath = dest;
      }
    } else if (msg.document) {
      hasMedia = true;
      const file = await ctx.api.getFile(msg.document.file_id);
      if (file.file_path) {
        const dest = path.join(store.getMediaDir(), `${msg.message_id}_${msg.document.file_name || "doc"}`);
        await downloadTelegramFile(file.file_path, dest);
        mediaPath = dest;
      }
    }
  } catch (err) {
    console.warn("Media download skipped or failed:", err);
  }

  const chatMsg: ChatMessage = {
    id: msg.message_id,
    chatId: ctx.chat.id,
    sender,
    senderId: msg.from?.id || 0,
    date: new Date(msg.date * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
    text: msg.text || "",
    caption: msg.caption,
    replyToMessageId: msg.reply_to_message?.message_id,
    hasMedia,
    mediaPath,
  };

  store.saveMessage(chatMsg);
}

async function handleSummarize(ctx: Context) {
  if (!ctx.message || !ctx.chat) return;

  const chatId = ctx.chat.id;
  const currentMsgId = ctx.message.message_id;
  const replyToId = ctx.message.reply_to_message?.message_id;

  // 1. 대상 대화 수집
  const { messages, fromMessageId, mode } = store.getMessagesForSummary(
    chatId,
    currentMsgId,
    replyToId
  );

  if (messages.length === 0) {
    await ctx.reply(
      `⚠️ 정리할 새로운 대화 내용이 없습니다.\n(기준 메시지 ID: #${fromMessageId || 0} 이후 대화 없음)`
    );
    return;
  }

  const rangeDescription =
    mode === "reply"
      ? `답장 지정 구간 (#${fromMessageId} ~ #${currentMsgId - 1})`
      : `체크포인트 이후 구간 (#${fromMessageId} ~ #${currentMsgId - 1})`;

  const statusMsg = await ctx.reply(
    `🔄 **[이슈 생성 파이프라인 가동]**\n` +
      `• 대상: ${rangeDescription}\n` +
      `• 수집된 메시지: ${messages.length}개\n\n` +
      `⏳ [${config.worker.engine.toUpperCase()}] ${config.worker.model} 모델로 분석 및 이슈 생성 중...`,
    { parse_mode: "Markdown" }
  );

  try {
    const formattedConversation = store.formatMessagesForPrompt(messages);

    // AI 파이프라인 실행 (One-Shot)
    const pipelineResult = await runSynthesisPipeline(formattedConversation, async (step) => {
      try {
        await ctx.api.editMessageText(
          chatId,
          statusMsg.message_id,
          `🔄 **[이슈 생성 파이프라인 가동]**\n• 대상: ${rangeDescription} (${messages.length}개)\n\n⏳ ${step}`
        );
      } catch {}
    });

    // 3. GitHub Issue 생성
    const ghResult = await createGitHubIssue(
      pipelineResult.issue.title,
      pipelineResult.issue.body
    );

    // 4. 체크포인트 갱신 (성공 시 워터마크 전진)
    store.setCheckpoint(chatId, currentMsgId);

    // 5. T3 Code 투입용 원클릭 프롬프트 생성
    let issueRef = "";
    let issueLink = "";
    if (ghResult.success && ghResult.issueNumber) {
      issueRef = `gh issue view ${ghResult.issueNumber}`;
      issueLink = `[GitHub Issue #${ghResult.issueNumber}](${ghResult.issueUrl})`;
    } else {
      issueRef = `(로컬 파일: ${ghResult.localSavedPath ? path.basename(ghResult.localSavedPath) : "생성됨"})`;
      issueLink = `로컬 저장됨: ${ghResult.localSavedPath || "경로 없음"}`;
    }

    const t3Prompt = `${issueRef}를 확인하고, 기술적 제약사항과 인수 조건을 충족하는 기능 구현 브랜치(feature/)를 생성한 뒤 개발에 착수해줘.`;

    const responseText =
      `🎉 **이슈 정리 및 등록 완료!** (${Math.round(pipelineResult.processingTimeMs / 1000)}초 소요)\n\n` +
      `📌 **제목:** ${escapeMarkdown(pipelineResult.issue.title)}\n` +
      `🔗 **링크:** ${issueLink}\n\n` +
      `------------------------------------\n` +
      `📋 **[T3 Code 원클릭 프롬프트 (복사용)]**\n` +
      `\`\`\`text\n${t3Prompt}\n\`\`\`\n` +
      `*(위 블록을 터치하여 복사 후 T3 Code에 그대로 붙여넣으세요)*\n` +
      `------------------------------------\n` +
      `📍 다음 정리 시점(체크포인트)이 #${currentMsgId}로 업데이트되었습니다.`;

    await ctx.api.editMessageText(chatId, statusMsg.message_id, responseText, {
      parse_mode: "Markdown",
    });
  } catch (err: any) {
    console.error("Pipeline failure:", err);
    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `❌ **정리 파이프라인 실행 중 오류가 발생했습니다.**\n\n상세: ${err.message || String(err)}`
    );
  }
}

async function downloadTelegramFile(telegramPath: string, localDest: string): Promise<void> {
  const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${telegramPath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file from Telegram: ${res.statusText}`);
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(localDest, Buffer.from(arrayBuffer));
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}
