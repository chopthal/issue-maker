import { Bot, Context, InlineKeyboard } from "grammy";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { store, ChatMessage, MediaKind } from "../storage/db.js";
import { settingsManager, RuntimeWorkerSettings, SettingsManager } from "../storage/settings.js";
import { runSynthesisPipeline, PipelineImageRef } from "../workers/pipeline.js";
import { createGitHubIssue } from "../github/issueCreator.js";
import { config } from "../config.js";

export function registerHandlers(bot: Bot) {
  // 1. 도움말 (/start, /help)
  bot.command(["start", "help"], async (ctx) => {
    const s = settingsManager.getSettings();
    await ctx.reply(
      `👋 **Issue-Maker 봇에 오신 것을 환영합니다!**\n\n` +
        `기획자와 개발자가 편하게 대화를 나누시면, AGY가 개발 가능한 GitHub Issue로 자동 정리해 드립니다.\n\n` +
        `⚙️ **현재 모델**: \`${s.model}\`\n\n` +
        `📌 **대화 정리**:\n` +
        `• \`/summary\` 또는 \`여기까지 정리\`: 체크포인트 이후 대화 정리\n` +
        `• **(답장으로) \`/summary\`**: 해당 메시지부터 현재까지 정리\n` +
        `• \`/checkpoint\` / \`/resetcheckpoint\`: 워터마크 확인·초기화\n\n` +
        `🛠️ **모델 설정**:\n` +
        `• \`/settings\` : 버튼으로 모델 선택\n` +
        `• \`/model <모델명>\` : 모델 직접 변경`,
      { parse_mode: "Markdown" }
    );
  });

  // 2. 체크포인트 확인/리셋
  bot.command("checkpoint", async (ctx) => {
    const cp = store.getCheckpoint(ctx.chat.id);
    await ctx.reply(`📍 현재 저장된 마지막 체크포인트 메시지 ID: #${cp || "없음(처음부터)"}`);
  });

  bot.command(["resetcheckpoint", "clearcheckpoint"], async (ctx) => {
    store.setCheckpoint(ctx.chat.id, 0);
    await ctx.reply("🔄 체크포인트가 초기화되었습니다. 다음 /summary 시 전체 대화가 대상이 됩니다.");
  });

  // 3. 설정 패널 (/settings, /config) — 모델 선택만
  bot.command(["settings", "config"], async (ctx) => {
    await sendSettingsMenu(ctx);
  });

  // 4. /model
  bot.command("model", async (ctx) => {
    const model = ctx.match?.trim();
    if (model) {
      const updated = settingsManager.setModel(model);
      await ctx.reply(`✅ 모델이 **\`${updated.model}\`**로 변경되었습니다.`, {
        parse_mode: "Markdown",
      });
    } else {
      const current = settingsManager.getSettings();
      const presets = SettingsManager.MODELS.join("\n• ");
      await ctx.reply(
        `📌 현재 모델: \`${current.model}\`\n\n` +
          `💡 **선택 가능 모델**:\n• ${presets}\n\n` +
          `변경: \`/model <모델명>\` 또는 \`/settings\``,
        { parse_mode: "Markdown" }
      );
    }
  });

  // 5. 인라인 키보드
  bot.callbackQuery(/^set_model:(.+)$/, async (ctx) => {
    const model = ctx.match[1];
    settingsManager.setModel(model);
    await ctx.answerCallbackQuery({ text: `모델: ${model}` });
    await editSettingsMenu(ctx);
  });

  bot.callbackQuery("close_menu", async (ctx) => {
    await ctx.deleteMessage();
  });

  // 6. 정리 트리거
  const triggerWords = ["/정리", "/summary", "여기까지 정리", "여기까지정리"];

  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text.trim();
    const isTrigger = triggerWords.some((w) => text.startsWith(w) || text === w);

    if (isTrigger) {
      await handleSummarize(ctx);
      return;
    }

    await saveIncomingMessage(ctx);
    await next();
  });

  // 7. 미디어 수신 — 로컬 영구 저장 없이 메타만 기록
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

function getSettingsText(s: RuntimeWorkerSettings): string {
  return (
    `⚙️ **Issue-Maker 모델 설정** (AGY 전용)\n\n` +
    `• **현재 모델**: \`${s.model}\`\n\n` +
    `아래에서 모델을 선택하세요. (effort는 모델명에 포함)`
  );
}

function getMainSettingsKeyboard(s: RuntimeWorkerSettings): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const m of SettingsManager.MODELS) {
    const isCurrent = s.model === m;
    keyboard.text(`${isCurrent ? "✅ " : ""}${m}`, `set_model:${m}`).row();
  }
  keyboard.text("🔄 닫기", "close_menu");
  return keyboard;
}

async function sendSettingsMenu(ctx: Context) {
  const s = settingsManager.getSettings();
  await ctx.reply(getSettingsText(s), {
    parse_mode: "Markdown",
    reply_markup: getMainSettingsKeyboard(s),
  });
}

async function editSettingsMenu(ctx: Context) {
  const s = settingsManager.getSettings();
  try {
    await ctx.editMessageText(getSettingsText(s), {
      parse_mode: "Markdown",
      reply_markup: getMainSettingsKeyboard(s),
    });
  } catch {}
}

async function saveIncomingMessage(ctx: Context) {
  if (!ctx.message || !ctx.chat) return;

  const msg = ctx.message;
  const sender =
    msg.from?.first_name ||
    msg.from?.username ||
    `User_${msg.from?.id || "unknown"}`;

  let hasMedia = false;
  let mediaKind: MediaKind | undefined;
  let telegramFileId: string | undefined;
  let fileName: string | undefined;

  if (msg.photo && msg.photo.length > 0) {
    hasMedia = true;
    mediaKind = "photo";
    // 가장 큰 해상도 photo의 file_id만 저장 (요약 시 임시 다운로드)
    telegramFileId = msg.photo[msg.photo.length - 1].file_id;
  } else if (msg.document) {
    hasMedia = true;
    mediaKind = "document";
    telegramFileId = msg.document.file_id;
    fileName = msg.document.file_name;
  } else if (msg.voice) {
    hasMedia = true;
    mediaKind = "voice";
    telegramFileId = msg.voice.file_id;
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
    mediaKind,
    telegramFileId,
    fileName,
  };

  store.saveMessage(chatMsg);
}

async function handleSummarize(ctx: Context) {
  if (!ctx.message || !ctx.chat) return;

  const chatId = ctx.chat.id;
  const currentMsgId = ctx.message.message_id;
  const replyToId = ctx.message.reply_to_message?.message_id;
  const currentSettings = settingsManager.getSettings();

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
      `• 대상: ${rangeDescription} (${messages.length}개)\n` +
      `• 모델: \`${currentSettings.model}\`\n\n` +
      `⏳ 분석 및 이슈 생성 중...`,
    { parse_mode: "Markdown" }
  );

  let tempDir: string | undefined;
  const warnings: string[] = [];

  try {
    const formattedConversation = store.formatMessagesForPrompt(messages);

    // 사진만 임시 다운로드 → AGY vision 전달 (영구 저장 없음)
    const prepared = await preparePhotoTempFiles(ctx, messages);
    tempDir = prepared.tempDir;
    warnings.push(...prepared.warnings);
    const images: PipelineImageRef[] = prepared.images;

    const pipelineResult = await runSynthesisPipeline(
      formattedConversation,
      async (step) => {
        try {
          await ctx.api.editMessageText(
            chatId,
            statusMsg.message_id,
            `🔄 **[이슈 생성 파이프라인 가동]**\n• 대상: ${rangeDescription} (${messages.length}개)\n\n⏳ ${step}`
          );
        } catch {}
      },
      images
    );

    const ghResult = await createGitHubIssue(
      pipelineResult.issue.title,
      pipelineResult.issue.body
    );

    store.setCheckpoint(chatId, currentMsgId);

    let issueRef = "";
    let issueLink = "";
    if (ghResult.success && ghResult.issueNumber) {
      issueRef = `gh issue view ${ghResult.issueNumber}`;
      issueLink = `[GitHub Issue #${ghResult.issueNumber}](${ghResult.issueUrl})`;
    } else {
      issueRef = `(로컬 파일: ${ghResult.localSavedPath ? path.basename(ghResult.localSavedPath) : "생성됨"})`;
      issueLink = `로컬 저장됨: ${ghResult.localSavedPath || "경로 없음"}`;
    }

    // 원클릭 프롬프트: 파악 및 논의만 (개발 착수 지시 없음)
    const t3Prompt = `${issueRef} 파악 및 논의`;

    const responseText =
      `🎉 **이슈 정리 및 등록 완료!** (${Math.round(pipelineResult.processingTimeMs / 1000)}초 소요)\n\n` +
      `📌 **제목:** ${escapeMarkdown(pipelineResult.issue.title)}\n` +
      `⚙️ **사용 모델:** \`${pipelineResult.model}\`\n` +
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

    if (warnings.length > 0) {
      await ctx.reply(`⚠️ ${warnings.join(" / ")}`);
    }
  } catch (err: any) {
    console.error("Pipeline failure:", err);
    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `❌ **정리 파이프라인 실행 중 오류가 발생했습니다.**\n\n상세: ${err.message || String(err)}`
    );
    if (warnings.length > 0) {
      await ctx.reply(`⚠️ ${warnings.join(" / ")}`);
    }
  } finally {
    if (tempDir) {
      cleanupTempDir(tempDir);
    }
  }
}

/**
 * 사진만 임시 디렉터리에 받아 AGY에 전달. 실패 시 경고만 수집.
 */
async function preparePhotoTempFiles(
  ctx: Context,
  messages: ChatMessage[]
): Promise<{ tempDir?: string; images: PipelineImageRef[]; warnings: string[] }> {
  const photos = messages.filter((m) => m.mediaKind === "photo" && m.telegramFileId);
  const warnings: string[] = [];
  const images: PipelineImageRef[] = [];

  if (photos.length === 0) {
    return { images, warnings };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-maker-vision-"));

  for (const m of photos) {
    try {
      const file = await ctx.api.getFile(m.telegramFileId!);
      if (!file.file_path) {
        warnings.push(`사진 #${m.id} 전달 실패`);
        continue;
      }
      const ext = path.extname(file.file_path) || ".jpg";
      const dest = path.join(tempDir, `${m.id}${ext}`);
      await downloadTelegramFile(file.file_path, dest);
      images.push({ messageId: m.id, localPath: dest });
    } catch (err) {
      console.warn(`Photo #${m.id} temp download failed:`, err);
      warnings.push(`사진 #${m.id} 전달 실패`);
    }
  }

  if (images.length === 0) {
    cleanupTempDir(tempDir);
    return { images, warnings };
  }

  return { tempDir, images, warnings };
}

async function downloadTelegramFile(telegramPath: string, localDest: string): Promise<void> {
  const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${telegramPath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file from Telegram: ${res.statusText}`);
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(localDest, Buffer.from(arrayBuffer));
}

function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn("Temp dir cleanup failed:", err);
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}
