import { Bot, Context, InlineKeyboard } from "grammy";
import path from "node:path";
import fs from "node:fs";
import { store, ChatMessage } from "../storage/db.js";
import { settingsManager, RuntimeWorkerSettings, SettingsManager } from "../storage/settings.js";
import { runSynthesisPipeline } from "../workers/pipeline.js";
import { createGitHubIssue } from "../github/issueCreator.js";
import { config, WorkerEngine } from "../config.js";

export function registerHandlers(bot: Bot) {
  // 1. 도움말 (/start, /help)
  bot.command(["start", "help"], async (ctx) => {
    const s = settingsManager.getSettings();
    await ctx.reply(
      `👋 **Issue-Maker 봇에 오신 것을 환영합니다!**\n\n` +
        `기획자와 개발자가 편하게 대화를 나누시면, AI 워커가 개발 가능한 GitHub Issue로 자동 정리해 드립니다.\n\n` +
        `⚙️ **현재 AI 설정**:\n` +
        `• 공급사: \`${s.engine.toUpperCase()}\` | 모델: \`${s.model}\` | Effort: \`${s.effort}\`\n\n` +
        `📌 **대화 정리 명령어**:\n` +
        `• \`/summary\` 또는 \`여기까지 정리\`: 직전 정리 시점(체크포인트) 이후 대화 정리\n` +
        `• **(답장으로) \`/summary\`**: 해당 메시지부터 현재까지 지정 구간 정리\n` +
        `• \`/checkpoint\`: 현재 워터마크 확인\n` +
        `• \`/resetcheckpoint\`: 워터마크 초기화\n\n` +
        `🛠️ **LLM 설정 변경 (실시간)**:\n` +
        `• \`/settings\` : 버튼 메뉴로 공급사/모델/effort 변경\n` +
        `• \`/engine agy|cursor|openai\` : 공급사 즉시 변경\n` +
        `• \`/model <모델명>\` : 모델명 직접 변경\n` +
        `• \`/effort low|medium|high|max\` : 추론 강도 변경\n` +
        `• \`/mode plan|auto\` : 실행 모드 변경`,
      { parse_mode: "Markdown" }
    );
  });

  // 2. 체크포인트 확인/리셋 (/checkpoint, /resetcheckpoint)
  bot.command("checkpoint", async (ctx) => {
    const cp = store.getCheckpoint(ctx.chat.id);
    await ctx.reply(`📍 현재 저장된 마지막 체크포인트 메시지 ID: #${cp || "없음(처음부터)"}`);
  });

  bot.command(["resetcheckpoint", "clearcheckpoint"], async (ctx) => {
    store.setCheckpoint(ctx.chat.id, 0);
    await ctx.reply("🔄 체크포인트가 초기화되었습니다. 다음 /summary 시 전체 대화가 대상이 됩니다.");
  });

  // 3. LLM 설정 인터랙티브 패널 (/settings, /config)
  bot.command(["settings", "config"], async (ctx) => {
    await sendSettingsMenu(ctx);
  });

  // 4. 빠른 텍스트 명령어 지원 (/engine, /model, /effort, /mode)
  bot.command(["engine", "provider"], async (ctx) => {
    const target = ctx.match?.trim().toLowerCase();
    if (target === "agy" || target === "cursor" || target === "openai") {
      const updated = settingsManager.setEngine(target as WorkerEngine);
      await ctx.reply(
        `✅ 공급사가 **[${updated.engine.toUpperCase()}]**로 변경되었습니다!\n• 모델: \`${updated.model}\`\n• Effort: \`${updated.effort}\``,
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.reply("⚠️ 사용법: `/engine agy` 또는 `/engine cursor` 또는 `/engine openai`", {
        parse_mode: "Markdown",
      });
    }
  });

  bot.command("model", async (ctx) => {
    const model = ctx.match?.trim();
    if (model) {
      const updated = settingsManager.setModel(model);
      await ctx.reply(`✅ 모델이 **\`${updated.model}\`**로 변경되었습니다. (공급사: ${updated.engine.toUpperCase()})`, {
        parse_mode: "Markdown",
      });
    } else {
      const current = settingsManager.getSettings();
      const presets = SettingsManager.PRESETS[current.engine].models.join("\n• ");
      await ctx.reply(
        `📌 현재 모델: \`${current.model}\` (공급사: ${current.engine.toUpperCase()})\n\n` +
          `💡 **추천 모델 목록**:\n• ${presets}\n\n` +
          `변경하려면: \`/model <원하는모델명>\` 입력`,
        { parse_mode: "Markdown" }
      );
    }
  });

  bot.command(["effort", "reasoning"], async (ctx) => {
    const effort = ctx.match?.trim().toLowerCase();
    const valid = ["low", "medium", "high", "xhigh", "max"];
    if (effort && valid.includes(effort)) {
      const updated = settingsManager.setEffort(effort as any);
      await ctx.reply(`✅ Effort(추론 강도)가 **\`${updated.effort}\`**로 설정되었습니다.`, {
        parse_mode: "Markdown",
      });
    } else {
      await ctx.reply("⚠️ 사용법: `/effort low` | `medium` | `high` | `max`", {
        parse_mode: "Markdown",
      });
    }
  });

  bot.command("mode", async (ctx) => {
    const mode = ctx.match?.trim().toLowerCase();
    if (mode === "plan" || mode === "auto") {
      const updated = settingsManager.setMode(mode as any);
      await ctx.reply(`✅ 모드가 **\`${updated.mode}\`**로 설정되었습니다.`, {
        parse_mode: "Markdown",
      });
    } else {
      await ctx.reply("⚠️ 사용법: `/mode plan` 또는 `/mode auto`", {
        parse_mode: "Markdown",
      });
    }
  });

  // 5. 인라인 키보드 콜백 쿼리 처리
  bot.callbackQuery(/^set_engine:(.+)$/, async (ctx) => {
    const engine = ctx.match[1] as WorkerEngine;
    settingsManager.setEngine(engine);
    await ctx.answerCallbackQuery({ text: `공급사가 ${engine.toUpperCase()}로 변경되었습니다.` });
    await editSettingsMenu(ctx);
  });

  bot.callbackQuery(/^set_model:(.+)$/, async (ctx) => {
    const model = ctx.match[1];
    settingsManager.setModel(model);
    await ctx.answerCallbackQuery({ text: `모델이 ${model}로 변경되었습니다.` });
    await editSettingsMenu(ctx);
  });

  bot.callbackQuery(/^set_effort:(.+)$/, async (ctx) => {
    const effort = ctx.match[1] as any;
    settingsManager.setEffort(effort);
    await ctx.answerCallbackQuery({ text: `Effort가 ${effort}로 변경되었습니다.` });
    await editSettingsMenu(ctx);
  });

  bot.callbackQuery(/^menu:(.+)$/, async (ctx) => {
    const view = ctx.match[1];
    if (view === "main") {
      await editSettingsMenu(ctx);
    } else if (view === "engine") {
      await showEngineSubmenu(ctx);
    } else if (view === "model") {
      await showModelSubmenu(ctx);
    } else if (view === "effort") {
      await showEffortSubmenu(ctx);
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("close_menu", async (ctx) => {
    await ctx.deleteMessage();
  });

  // 6. 정리 트리거 핸들러 (/정리, /summary, 또는 텍스트 내 트리거 감지)
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

  // 7. 미디어 메시지 수신 (사진, 문서 등)
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
    `⚙️ **Issue-Maker AI 파이프라인 설정**\n\n` +
    `• **공급사 (Engine)**: \`${s.engine.toUpperCase()}\`\n` +
    `• **모델 (Model)**: \`${s.model}\`\n` +
    `• **Effort (추론 강도)**: \`${s.effort}\`\n` +
    `• **실행 모드 (Mode)**: \`${s.mode}\`\n\n` +
    `변경하고 싶은 항목의 버튼을 선택하세요:`
  );
}

function getMainSettingsKeyboard(s: RuntimeWorkerSettings): InlineKeyboard {
  return new InlineKeyboard()
    .text(`🏢 공급사 변경 [${s.engine.toUpperCase()}]`, "menu:engine")
    .row()
    .text(`🎯 모델 변경 [${s.model}]`, "menu:model")
    .row()
    .text(`🧠 Effort 변경 [${s.effort}]`, "menu:effort")
    .row()
    .text("🔄 닫기", "close_menu");
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

async function showEngineSubmenu(ctx: Context) {
  const s = settingsManager.getSettings();
  const keyboard = new InlineKeyboard()
    .text(`${s.engine === "agy" ? "✅ " : ""}AGY (Antigravity)`, "set_engine:agy")
    .row()
    .text(`${s.engine === "cursor" ? "✅ " : ""}Cursor Agent`, "set_engine:cursor")
    .row()
    .text(`${s.engine === "openai" ? "✅ " : ""}OpenAI Direct API`, "set_engine:openai")
    .row()
    .text("⬅️ 메인 설정으로 돌아가기", "menu:main");

  await ctx.editMessageText(
    `🏢 **공급사(Engine) 선택**\n\n현재: \`${s.engine.toUpperCase()}\`\n사용하실 AI 공급사를 선택하세요:`,
    {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    }
  );
}

async function showModelSubmenu(ctx: Context) {
  const s = settingsManager.getSettings();
  const presets = SettingsManager.PRESETS[s.engine].models;
  const keyboard = new InlineKeyboard();

  for (const m of presets) {
    const isCurrent = s.model === m;
    keyboard.text(`${isCurrent ? "✅ " : ""}${m}`, `set_model:${m}`).row();
  }
  keyboard.text("⬅️ 메인 설정으로 돌아가기", "menu:main");

  await ctx.editMessageText(
    `🎯 **추천 모델 선택** (공급사: \`${s.engine.toUpperCase()}\`)\n\n현재 모델: \`${s.model}\`\n원하는 모델을 선택하거나, 직접 \`/모델 <모델명>\` 명령어로 임의 지정할 수 있습니다.`,
    {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    }
  );
}

async function showEffortSubmenu(ctx: Context) {
  const s = settingsManager.getSettings();
  const efforts = ["low", "medium", "high", "max"];
  const keyboard = new InlineKeyboard();

  for (const e of efforts) {
    const isCurrent = s.effort === e;
    keyboard.text(`${isCurrent ? "✅ " : ""}${e.toUpperCase()}`, `set_effort:${e}`);
  }
  keyboard.row().text("⬅️ 메인 설정으로 돌아가기", "menu:main");

  await ctx.editMessageText(
    `🧠 **Effort(추론 강도) 선택**\n\n현재 Effort: \`${s.effort}\`\n(AGY Gemini 및 추론 모델 호출 시 적용됩니다)`,
    {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    }
  );
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
  const currentSettings = settingsManager.getSettings();

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
      `• 대상: ${rangeDescription} (${messages.length}개)\n` +
      `• 워커: [${currentSettings.engine.toUpperCase()}] \`${currentSettings.model}\` (effort: ${currentSettings.effort})\n\n` +
      `⏳ 분석 및 이슈 생성 중...`,
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
      `⚙️ **사용 모델:** [${pipelineResult.engine.toUpperCase()}] \`${pipelineResult.model}\`\n` +
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
