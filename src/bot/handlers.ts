import { Bot, Context, InlineKeyboard } from "grammy";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { store, ChatMessage, MediaKind } from "../storage/db.js";
import { settingsManager, RuntimeWorkerSettings, SettingsManager } from "../storage/settings.js";
import { runSynthesisPipeline, PipelineImageRef } from "../workers/pipeline.js";
import { createGitHubIssue } from "../github/issueCreator.js";
import { config } from "../config.js";
import { formatUptime, RESTART_EXIT_CODE } from "../runtime/appState.js";
import { jobManager, JobCancelledError, throwIfAborted } from "../runtime/jobManager.js";
import { lastIssueStore } from "../storage/lastIssues.js";

type SummarizeMode = "publish" | "preview";

export function registerHandlers(bot: Bot) {
  // 1. 도움말 (/start, /help)
  bot.command(["start", "help"], async (ctx) => {
    const s = settingsManager.getSettings();
    await ctx.reply(
      `👋 <b>Issue-Maker 봇에 오신 것을 환영합니다!</b>\n\n` +
        `기획자와 개발자가 편하게 대화를 나누시면, AGY가 개발 가능한 GitHub Issue로 자동 정리해 드립니다.\n\n` +
        `⚙️ <b>현재 모델</b>: <code>${escapeHtml(s.model)}</code>\n\n` +
        `📌 <b>대화 정리</b>:\n` +
        `• <code>/summary</code> 또는 <code>여기까지 정리</code>: 체크포인트 이후 대화 → Issue 등록\n` +
        `• <code>/preview</code>: Issue 등록 없이 초안만 확인\n` +
        `• <b>(답장으로)</b> <code>/summary</code> 또는 <code>/preview</code>: 지정 구간만 처리\n` +
        `• <b>(답장으로)</b> <code>/exclude</code>: 해당 메시지를 이슈 대상에서 제외/해제(토글)\n` +
        `• <code>/excludes</code> / <code>/clearexclude</code>: 제외 목록 확인·초기화\n` +
        `• <code>/cancel</code>: 진행 중 작업 취소\n` +
        `• <b>전달(forward) 선별</b>: 토의방에서 필요한 메시지만 여러 개 선택 → 이 방(또는 봇 1:1)으로 전달 → <code>/summary</code>\n` +
        `  (원 작성자·시각 유지. ⚠️ '보낸 사람 이름 숨기기'로 전달하면 작성자 정보가 사라집니다)\n` +
        `• <code>/checkpoint</code> / <code>/from</code> / <code>/resetcheckpoint</code>: 시작 지점 확인·지정(답장)·초기화\n\n` +
        `ℹ️ 이슈로 등록된 오래된 로컬 대화는 자동 정리됩니다. (최근 버퍼만 답장 재요약용으로 유지)\n\n` +
        `🛠️ <b>모델·상태</b>:\n` +
        `• <code>/settings</code> / <code>/model</code>: 모델 변경\n` +
        `• <code>/status</code> <code>/ping</code> <code>/chatid</code> <code>/last</code> <code>/restart</code>`,
      { parse_mode: "HTML" }
    );
  });

  // 2. 체크포인트
  bot.command("checkpoint", async (ctx) => {
    const cp = store.getCheckpoint(ctx.chat.id);
    await ctx.reply(`📍 현재 저장된 마지막 체크포인트 메시지 ID: #${cp || "없음(처음부터)"}`);
  });

  bot.command(["from", "setcheckpoint"], async (ctx) => {
    if (!ctx.chat || !ctx.message) return;

    const replyTo = ctx.message.reply_to_message;
    if (!replyTo) {
      await ctx.reply(
        "ℹ️ 요약을 시작하고 싶은 메시지에 <b>답장(Reply)</b>한 뒤 <code>/from</code>을 입력하세요.\n" +
          "해당 메시지부터 다음 <code>/summary</code> 대상에 포함됩니다.",
        { parse_mode: "HTML" }
      );
      return;
    }

    const targetMsgId = replyTo.message_id;
    // checkpoint는 '이 ID 이하(<=)는 이미 처리 완료'를 의미하므로,
    // 답장한 메시지가 다음 요약(id > checkpoint)에 포함되도록 targetMsgId - 1로 설정
    const newCheckpoint = Math.max(0, targetMsgId - 1);
    store.setCheckpoint(ctx.chat.id, newCheckpoint);

    const sender =
      replyTo.forward_origin
        ? getForwardOriginSender(replyTo.forward_origin)
        : replyTo.from?.first_name || replyTo.from?.username || "알 수 없음";
    const snippet = (replyTo.text || replyTo.caption || "(미디어 메시지)").slice(0, 40);

    await ctx.reply(
      `📍 <b>요약 시작 지점 설정 완료</b>\n` +
        `• 기준 메시지: #${targetMsgId} (<b>${escapeHtml(sender)}</b>: ${escapeHtml(snippet)})\n` +
        `• 다음 <code>/summary</code> 또는 <code>/preview</code> 시 <b>이 메시지부터 포함</b>되어 정리됩니다.`,
      { parse_mode: "HTML" }
    );
  });

  bot.command(["resetcheckpoint", "clearcheckpoint"], async (ctx) => {
    store.setCheckpoint(ctx.chat.id, 0);
    await ctx.reply(
      "🔄 체크포인트가 초기화되었습니다. 다음 /summary 시 로컬에 남아 있는 대화가 대상이 됩니다.\n" +
        "(이미 이슈화된 뒤 자동 정리된 오래된 메시지는 포함되지 않을 수 있습니다.)"
    );
  });

  // 2-1. 제외 목록
  bot.command("exclude", async (ctx) => {
    if (!ctx.chat || !ctx.message) return;

    const replyToId = ctx.message.reply_to_message?.message_id;
    if (!replyToId) {
      await ctx.reply(
        "ℹ️ 제외할 메시지에 **답장**한 뒤 `/exclude`를 입력하세요.\n" +
          "같은 메시지에 다시 치면 제외가 해제됩니다.\n" +
          "목록 확인: `/excludes` / 초기화: `/clearexclude`"
      );
      return;
    }

    const { added, ids } = store.toggleExclude(ctx.chat.id, replyToId);
    if (added) {
      await ctx.reply(
        `🚫 메시지 #${replyToId}을(를) 이슈 대상에서 제외했습니다.\n` +
          `현재 제외: ${formatExcludeIds(ids)} (${ids.length}개)`
      );
    } else {
      await ctx.reply(
        `✅ 메시지 #${replyToId} 제외를 해제했습니다.\n` +
          `현재 제외: ${formatExcludeIds(ids)} (${ids.length}개)`
      );
    }
  });

  bot.command(["excludes", "listexclude"], async (ctx) => {
    if (!ctx.chat) return;
    const ids = store.getExcludedMessageIds(ctx.chat.id);
    if (ids.length === 0) {
      await ctx.reply("📭 현재 제외된 메시지가 없습니다.");
      return;
    }
    await ctx.reply(`🚫 제외 목록 (${ids.length}개):\n${formatExcludeIds(ids)}`);
  });

  bot.command(["clearexclude", "clearexcludes"], async (ctx) => {
    if (!ctx.chat) return;
    const removed = store.clearExcludes(ctx.chat.id);
    if (removed === 0) {
      await ctx.reply("ℹ️ 비울 제외 목록이 없습니다.");
      return;
    }
    await ctx.reply(`🔄 제외 목록 ${removed}개를 초기화했습니다.`);
  });

  // 3. 설정
  bot.command(["settings", "config"], async (ctx) => {
    await sendSettingsMenu(ctx);
  });

  bot.command("model", async (ctx) => {
    const model = ctx.match?.trim();
    if (model) {
      const updated = settingsManager.setModel(model);
      await ctx.reply(`✅ 모델이 <b><code>${escapeHtml(updated.model)}</code></b>로 변경되었습니다.`, {
        parse_mode: "HTML",
      });
    } else {
      const current = settingsManager.getSettings();
      const presets = SettingsManager.MODELS.map((m) => `• <code>${escapeHtml(m)}</code>`).join("\n");
      await ctx.reply(
        `📌 현재 모델: <code>${escapeHtml(current.model)}</code>\n\n` +
          `💡 <b>선택 가능 모델</b>:\n${presets}\n\n` +
          `변경: <code>/model &lt;모델명&gt;</code> 또는 <code>/settings</code>`,
        { parse_mode: "HTML" }
      );
    }
  });

  // 4. 유틸 명령어
  bot.command("ping", async (ctx) => {
    const sentAt = Date.now();
    const msg = await ctx.reply("pong");
    const latency = Date.now() - sentAt;
    try {
      await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, `pong (${latency}ms)`);
    } catch {}
  });

  bot.command("chatid", async (ctx) => {
    if (!ctx.chat) return;
    await ctx.reply(
      `🆔 Chat ID: ${ctx.chat.id}\n` +
        `유형: ${ctx.chat.type}\n\n` +
        `ALLOWED_CHAT_IDS=${ctx.chat.id}`
    );
  });

  bot.command("status", async (ctx) => {
    if (!ctx.chat) return;
    const s = settingsManager.getSettings();
    const cp = store.getCheckpoint(ctx.chat.id);
    const repo =
      config.github.owner && config.github.repo
        ? `${config.github.owner}/${config.github.repo}`
        : "(미설정 - 로컬저장 모드)";
    const busy = jobManager.isActive(ctx.chat.id) ? "진행 중" : "대기";

    const excludeCount = store.getExcludedMessageIds(ctx.chat.id).length;

    await ctx.reply(
      `📊 <b>Issue-Maker 상태</b>\n\n` +
        `• 모델: <code>${escapeHtml(s.model)}</code> (AGY / ${escapeHtml(s.mode)})\n` +
        `• 저장소: <code>${escapeHtml(repo)}</code>\n` +
        `• 체크포인트: <code>#${cp || 0}</code>\n` +
        `• 제외 목록: ${excludeCount}개\n` +
        `• 업타임: ${formatUptime()}\n` +
        `• 이 방 작업: ${busy}`,
      { parse_mode: "HTML" }
    );
  });

  bot.command("last", async (ctx) => {
    if (!ctx.chat) return;
    const last = lastIssueStore.get(ctx.chat.id);
    if (!last) {
      await ctx.reply("📭 이 방에서 생성·기록된 이슈가 아직 없습니다.");
      return;
    }

    const link = last.issueUrl
      ? `<a href="${escapeHtml(last.issueUrl)}">#${last.issueNumber}</a>`
      : last.localSavedPath
        ? `로컬: <code>${escapeHtml(path.basename(last.localSavedPath))}</code>`
        : "(링크 없음)";

    await ctx.reply(
      `📌 <b>마지막 이슈</b>\n\n` +
        `• 제목: ${escapeHtml(last.title)}\n` +
        `• 링크: ${link}\n` +
        `• 모델: <code>${escapeHtml(last.model)}</code>\n` +
        `• 시각: ${escapeHtml(last.createdAt)}`,
      { parse_mode: "HTML" }
    );
  });

  bot.command("cancel", async (ctx) => {
    if (!ctx.chat) return;
    const cancelled = jobManager.cancel(ctx.chat.id);
    if (cancelled) {
      await ctx.reply("🛑 진행 중 작업을 취소했습니다.");
    } else {
      await ctx.reply("ℹ️ 취소할 진행 중 작업이 없습니다.");
    }
  });

  bot.command("restart", async (ctx) => {
    await ctx.reply(
      "🔄 봇을 재시작합니다.\n(트레이 런처가 실행 중이면 자동으로 다시 올라옵니다.)"
    );
    setTimeout(() => {
      console.log(`[Restart] Telegram /restart requested. exiting with code ${RESTART_EXIT_CODE}`);
      process.exit(RESTART_EXIT_CODE);
    }, 500);
  });

  bot.command("preview", async (ctx) => {
    await handleSummarize(ctx, "preview");
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
    // 전달된 메시지 안의 "/summary", "여기까지 정리" 등은 트리거가 아닌 대화 내용으로 취급
    const isTrigger =
      !ctx.message.forward_origin && triggerWords.some((w) => text.startsWith(w) || text === w);

    if (isTrigger) {
      await handleSummarize(ctx, "publish");
      return;
    }

    await saveIncomingMessage(ctx);
    await next();
  });

  // 7. 미디어 수신 — 로컬 영구 저장 없이 메타만 기록
  bot.on(["message:photo", "message:document", "message:voice"], async (ctx, next) => {
    const caption = ctx.message.caption || "";
    const isTrigger =
      !ctx.message.forward_origin &&
      triggerWords.some((w) => caption.startsWith(w) || caption === w);

    if (isTrigger) {
      await handleSummarize(ctx, "publish");
      return;
    }

    await saveIncomingMessage(ctx);
    await next();
  });
}

function getSettingsText(s: RuntimeWorkerSettings): string {
  return (
    `⚙️ <b>Issue-Maker 모델 설정</b> (AGY 전용)\n\n` +
    `• <b>현재 모델</b>: <code>${escapeHtml(s.model)}</code>\n\n` +
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
    parse_mode: "HTML",
    reply_markup: getMainSettingsKeyboard(s),
  });
}

async function editSettingsMenu(ctx: Context) {
  const s = settingsManager.getSettings();
  try {
    await ctx.editMessageText(getSettingsText(s), {
      parse_mode: "HTML",
      reply_markup: getMainSettingsKeyboard(s),
    });
  } catch {}
}

type ForwardOrigin = NonNullable<NonNullable<Context["message"]>["forward_origin"]>;

/** 전달 메시지의 원 작성자 표시 이름 (계정 연결 비공개 사용자는 표시 이름만 제공됨) */
function getForwardOriginSender(origin: ForwardOrigin): string {
  switch (origin.type) {
    case "user": {
      const u = origin.sender_user;
      const fullName = [u.first_name, u.last_name].filter(Boolean).join(" ");
      return fullName || u.username || `User_${u.id}`;
    }
    case "hidden_user":
      return origin.sender_user_name || "Unknown";
    case "chat":
      return origin.author_signature || origin.sender_chat.title || "Chat";
    case "channel":
      return origin.author_signature || origin.chat.title || "Channel";
  }
}

async function saveIncomingMessage(ctx: Context) {
  if (!ctx.message || !ctx.chat) return;

  const msg = ctx.message;
  const origin = msg.forward_origin;
  const sender = origin
    ? getForwardOriginSender(origin)
    : msg.from?.first_name || msg.from?.username || `User_${msg.from?.id || "unknown"}`;
  const senderId =
    origin?.type === "user" ? origin.sender_user.id : origin ? 0 : msg.from?.id || 0;
  const sentAt = origin ? origin.date : msg.date;

  let hasMedia = false;
  let mediaKind: MediaKind | undefined;
  let telegramFileId: string | undefined;
  let fileName: string | undefined;

  if (msg.photo && msg.photo.length > 0) {
    hasMedia = true;
    mediaKind = "photo";
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
    senderId,
    date: new Date(sentAt * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
    text: msg.text || "",
    caption: msg.caption,
    // 전달된 메시지의 답장 관계는 원본 방 기준이 아니므로 기록하지 않음
    replyToMessageId: origin ? undefined : msg.reply_to_message?.message_id,
    isForwarded: origin ? true : undefined,
    hasMedia,
    mediaKind,
    telegramFileId,
    fileName,
  };

  store.saveMessage(chatMsg);
}

async function handleSummarize(ctx: Context, mode: SummarizeMode) {
  if (!ctx.message || !ctx.chat) return;

  const chatId = ctx.chat.id;
  const currentMsgId = ctx.message.message_id;
  const replyToId = ctx.message.reply_to_message?.message_id;
  const currentSettings = settingsManager.getSettings();
  const isPreview = mode === "preview";

  const { messages: rangedMessages, fromMessageId, mode: rangeMode } = store.getMessagesForSummary(
    chatId,
    currentMsgId,
    replyToId
  );

  if (rangedMessages.length === 0) {
    await ctx.reply(
      `⚠️ 정리할 새로운 대화 내용이 없습니다.\n(기준 메시지 ID: #${fromMessageId || 0} 이후 대화 없음)`
    );
    return;
  }

  const excludedIds = new Set(store.getExcludedMessageIds(chatId));
  const excludedInRange = rangedMessages.filter((m) => excludedIds.has(m.id));
  const messages = rangedMessages.filter((m) => !excludedIds.has(m.id));

  if (messages.length === 0) {
    await ctx.reply(
      `⚠️ 구간 메시지 ${rangedMessages.length}개가 모두 제외되어 정리할 내용이 없습니다.\n` +
        `제외 해제: 해당 메시지에 답장 후 \`/exclude\` / 전체 초기화: \`/clearexclude\``
    );
    return;
  }

  const rangeDescription =
    rangeMode === "reply"
      ? `답장 지정 구간 (#${fromMessageId} ~ #${currentMsgId - 1})`
      : `체크포인트 이후 구간 (#${fromMessageId} ~ #${currentMsgId - 1})`;
  const excludeDescription =
    excludedInRange.length > 0
      ? `• 제외: ${excludedInRange.length}개 (${formatExcludeIds(excludedInRange.map((m) => m.id))})\n`
      : "";

  const pipelineLabel = isPreview ? "초안 미리보기" : "이슈 생성";
  const initialText =
    `🔄 <b>[${escapeHtml(pipelineLabel)} 파이프라인 가동]</b>\n` +
    `• 대상: ${escapeHtml(rangeDescription)} (${messages.length}개)\n` +
    (excludeDescription ? `• 제외: ${excludedInRange.length}개 (${escapeHtml(formatExcludeIds(excludedInRange.map((m) => m.id)))})\n` : "") +
    `• 모델: <code>${escapeHtml(currentSettings.model)}</code>\n\n` +
    `⏳ 분석 중... (<code>/cancel</code>로 취소 가능)`;

  let statusMsg;
  try {
    statusMsg = await ctx.reply(initialText, { parse_mode: "HTML" });
  } catch {
    statusMsg = await ctx.reply(initialText);
  }

  const controller = jobManager.start(chatId);
  const signal = controller.signal;
  let tempDir: string | undefined;
  const warnings: string[] = [];

  try {
    throwIfAborted(signal);
    const formattedConversation = store.formatMessagesForPrompt(messages);

    const prepared = await preparePhotoTempFiles(ctx, messages, signal);
    tempDir = prepared.tempDir;
    warnings.push(...prepared.warnings);
    const images: PipelineImageRef[] = prepared.images;

    throwIfAborted(signal);

    const pipelineResult = await runSynthesisPipeline(
      formattedConversation,
      async (step) => {
        const stepText =
          `🔄 <b>[${escapeHtml(pipelineLabel)} 파이프라인 가동]</b>\n` +
          `• 대상: ${escapeHtml(rangeDescription)} (${messages.length}개)\n` +
          (excludeDescription ? `• 제외: ${excludedInRange.length}개 (${escapeHtml(formatExcludeIds(excludedInRange.map((m) => m.id)))})\n` : "") +
          `\n⏳ ${escapeHtml(step)}`;
        await safeEditMessageText(ctx, chatId, statusMsg.message_id, stepText, {
          parse_mode: "HTML",
        });
      },
      images,
      signal
    );

    throwIfAborted(signal);

    if (isPreview) {
      const header =
        `👀 <b>초안 미리보기</b> (${Math.round(pipelineResult.processingTimeMs / 1000)}초)\n` +
        `⚙️ 모델: <code>${escapeHtml(pipelineResult.model)}</code>\n` +
        `📌 제목: <b>${escapeHtml(pipelineResult.issue.title)}</b>\n\n` +
        `------------------------------------\n`;
      const footer =
        `\n------------------------------------\n` +
        `ℹ️ Issue는 등록되지 않았고, 체크포인트·제외 목록도 변경되지 않았습니다.\n` +
        `등록하려면 <code>/summary</code>를 사용하세요.`;

      // HTML 태그가 중간에 깨져서 파싱 오류가 발생하지 않도록 본문 텍스트 자체를 먼저 자른 후 HTML 조립
      const rawBody = pipelineResult.issue.body || "";
      const maxBodyChars = 2800;
      const truncatedRawBody =
        rawBody.length > maxBodyChars
          ? rawBody.slice(0, maxBodyChars - 30) + "\n\n…(내용이 길어 생략됨)"
          : rawBody;
      let finalEscapedBody = escapeHtml(truncatedRawBody);

      const maxTotalLength = 4000;
      if (header.length + footer.length + finalEscapedBody.length + 15 > maxTotalLength) {
        const conservativeLimit = Math.max(
          500,
          Math.floor((maxTotalLength - header.length - footer.length - 50) / 4)
        );
        finalEscapedBody = escapeHtml(
          rawBody.slice(0, conservativeLimit) + "\n\n…(내용이 길어 생략됨)"
        );
      }

      const previewHtml = `${header}<pre>${finalEscapedBody}</pre>${footer}`;

      await safeEditMessageText(ctx, chatId, statusMsg.message_id, previewHtml, {
        parse_mode: "HTML",
      });
    } else {
      const ghResult = await createGitHubIssue(
        pipelineResult.issue.title,
        pipelineResult.issue.body
      );

      throwIfAborted(signal);

      store.setCheckpoint(chatId, currentMsgId);
      store.clearExcludes(chatId);
      const pruneResult = store.pruneMessages(chatId);
      if (pruneResult.removed > 0) {
        console.log(
          `[Storage] chat ${chatId} prune: removed ${pruneResult.removed}, remaining ${pruneResult.remaining}`
        );
      }

      lastIssueStore.save(chatId, {
        title: pipelineResult.issue.title,
        issueNumber: ghResult.issueNumber,
        issueUrl: ghResult.issueUrl,
        localSavedPath: ghResult.localSavedPath,
        model: pipelineResult.model,
        createdAt: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
      });

      let issueRef = "";
      let issueLink = "";
      if (ghResult.success && ghResult.issueNumber) {
        issueRef = `gh issue view ${ghResult.issueNumber}`;
        issueLink = `<a href="${escapeHtml(ghResult.issueUrl || "")}">GitHub Issue #${ghResult.issueNumber}</a>`;
      } else {
        const localName = ghResult.localSavedPath ? path.basename(ghResult.localSavedPath) : "생성됨";
        issueRef = `(로컬 파일: ${localName})`;
        issueLink = `로컬 저장됨: <code>${escapeHtml(ghResult.localSavedPath || "경로 없음")}</code>`;
      }

      const t3Prompt = `${issueRef} 파악 및 논의. 답변은 한국어로.`;

      const responseHtml =
        `🎉 <b>이슈 정리 및 등록 완료!</b> (${Math.round(pipelineResult.processingTimeMs / 1000)}초 소요)\n\n` +
        `📌 <b>제목:</b> ${escapeHtml(pipelineResult.issue.title)}\n` +
        `⚙️ <b>사용 모델:</b> <code>${escapeHtml(pipelineResult.model)}</code>\n` +
        `🔗 <b>링크:</b> ${issueLink}\n\n` +
        `------------------------------------\n` +
        `📋 <b>[T3 Code 원클릭 프롬프트 (복사용)]</b>\n` +
        `<pre><code>${escapeHtml(t3Prompt)}</code></pre>\n` +
        `<i>(위 블록을 터치하여 복사 후 T3 Code에 그대로 붙여넣으세요)</i>\n` +
        `------------------------------------\n` +
        `📍 다음 정리 시점(체크포인트)이 #${currentMsgId}로 업데이트되었습니다.\n` +
        `🚫 제외 목록은 초기화되었습니다.`;

      await safeEditMessageText(ctx, chatId, statusMsg.message_id, responseHtml, {
        parse_mode: "HTML",
      });
    }

    if (warnings.length > 0) {
      await ctx.reply(`⚠️ ${warnings.join(" / ")}`);
    }
  } catch (err: any) {
    if (err instanceof JobCancelledError || signal.aborted) {
      const cancelText = `🛑 <b>${escapeHtml(pipelineLabel)}이(가) 취소되었습니다.</b>`;
      await safeEditMessageText(ctx, chatId, statusMsg.message_id, cancelText, {
        parse_mode: "HTML",
      });
    } else {
      console.error("Pipeline failure:", err);
      const errorMsg = err?.message || String(err);
      const errorText =
        `❌ <b>정리 파이프라인 실행 중 오류가 발생했습니다.</b>\n\n` +
        `상세: <code>${escapeHtml(errorMsg)}</code>`;
      await safeEditMessageText(ctx, chatId, statusMsg.message_id, errorText, {
        parse_mode: "HTML",
      });
      if (warnings.length > 0) {
        await ctx.reply(`⚠️ ${warnings.join(" / ")}`);
      }
    }
  } finally {
    jobManager.finish(chatId, controller);
    if (tempDir) {
      cleanupTempDir(tempDir);
    }
  }
}

async function preparePhotoTempFiles(
  ctx: Context,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<{ tempDir?: string; images: PipelineImageRef[]; warnings: string[] }> {
  const photos = messages.filter((m) => m.mediaKind === "photo" && m.telegramFileId);
  const warnings: string[] = [];
  const images: PipelineImageRef[] = [];

  if (photos.length === 0) {
    return { images, warnings };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-maker-vision-"));

  for (const m of photos) {
    throwIfAborted(signal);
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
      if (err instanceof JobCancelledError) throw err;
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

/**
 * HTML 특수문자(&, <, >)를 이스케이프하여 텔레그램 HTML parse_mode 파싱 에러를 방지합니다.
 */
export function escapeHtml(text: string | null | undefined): string {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * parse_mode로 editMessageText를 시도하고,
 * can't parse entities 에러 발생 시 parse_mode 없이 plain text로 fallback 재시도하여 파이프라인 중단을 보호합니다.
 */
export async function safeEditMessageText(
  ctx: Context,
  chatId: number,
  messageId: number,
  text: string,
  options?: Parameters<typeof ctx.api.editMessageText>[3]
): Promise<void> {
  try {
    await ctx.api.editMessageText(chatId, messageId, text, options);
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    if (errMsg.includes("message is not modified")) {
      return;
    }
    if (errMsg.includes("can't parse entities") || errMsg.includes("entity")) {
      console.warn(`[safeEditMessageText] parse error, falling back to plain text: ${errMsg}`);
      try {
        const { parse_mode: _pm, ...fallbackOptions } = options || {};
        const fallbackText =
          text.length > 4000 ? text.slice(0, 3970) + "\n\n…(내용이 길어 생략됨)" : text;
        await ctx.api.editMessageText(chatId, messageId, fallbackText, fallbackOptions);
        return;
      } catch (fallbackErr: any) {
        if (fallbackErr?.message?.includes("message is not modified")) return;
        console.error("[safeEditMessageText] fallback to plain text failed:", fallbackErr);
      }
    } else {
      console.warn("[safeEditMessageText] editMessageText failed:", errMsg);
    }
  }
}

function formatExcludeIds(ids: number[]): string {
  if (ids.length === 0) return "(없음)";
  return ids.map((id) => `#${id}`).join(", ");
}

/** Telegram 메시지 4096자 제한에 맞춤 */
function truncateTelegramMessage(text: string, maxLen = 4000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 30) + "\n\n…(내용이 길어 생략됨)";
}
