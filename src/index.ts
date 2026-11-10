import { logger } from "./utils/logger.js";

// 콘솔 출력 및 파일 로깅에 타임스탬프와 롤링 버퍼 적용
logger.hookGlobalConsole();

import { Bot } from "grammy";
import { config } from "./config.js";
import { registerHandlers } from "./bot/handlers.js";
import { settingsManager } from "./storage/settings.js";
import { store } from "./storage/db.js";

async function main() {
  console.log("==========================================");
  console.log("🚀 Issue-Maker Bot Server Starting...");
  console.log("==========================================");

  if (!config.telegram.botToken) {
    console.error("❌ 오류: TELEGRAM_BOT_TOKEN이 .env 파일에 설정되지 않았습니다.");
    console.log("👉 .env 파일을 생성하고 아래 항목들을 채워주세요:");
    console.log("   TELEGRAM_BOT_TOKEN=...");
    console.log("   GITHUB_TOKEN=...");
    console.log("   GITHUB_OWNER=...");
    console.log("   GITHUB_REPO=...");
    process.exit(1);
  }

  const bot = new Bot(config.telegram.botToken);

  // 화이트리스트 Chat ID 체크 미들웨어 (설정된 경우에만 적용)
  if (config.telegram.allowedChatIds && config.telegram.allowedChatIds.length > 0) {
    bot.use(async (ctx, next) => {
      if (ctx.chat && !config.telegram.allowedChatIds?.includes(ctx.chat.id)) {
        console.warn(`[Security] Unauthorized chat ID attempted access: ${ctx.chat.id}`);
        return;
      }
      await next();
    });
  }

  registerHandlers(bot);

  const sendStartupNotification = async () => {
    if (!config.telegram.allowedChatIds || config.telegram.allowedChatIds.length === 0) {
      return;
    }

    const s = settingsManager.getSettings();
    const repoText =
      config.github.owner && config.github.repo
        ? `${config.github.owner}/${config.github.repo}`
        : "(미설정 - 로컬저장 모드)";

    const notificationText =
      `🚀 **Issue-Maker 봇이 시작되었습니다!**\n\n` +
      `⚙️ **현재 모델**: \`${s.model}\` (AGY)\n` +
      `📦 **대상 저장소**: \`${repoText}\`\n\n` +
      `💬 대화 후 \`/summary\` 또는 \`여기까지 정리\`를 입력하시면 이슈로 등록됩니다.\n` +
      `도움말은 \`/help\`, 모델 변경은 \`/settings\`를 참고하세요.`;

    for (const chatId of config.telegram.allowedChatIds) {
      try {
        await bot.api.sendMessage(chatId, notificationText, { parse_mode: "Markdown" });
      } catch (err: any) {
        console.warn(`[Notification] Chat ${chatId} 시작 알림 발송 실패:`, err.message || err);
      }
    }
  };

  const stop = async () => {
    console.log("\n🛑 Stopping Issue-Maker Bot Server...");
    try {
      bot.stop();
    } catch {}
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const connectWithRetry = async (maxRetries = 10): Promise<any> => {
      let attempts = 0;
      while (true) {
        attempts++;
        try {
          return await bot.api.getMe();
        } catch (err: any) {
          console.warn(`[Network] 텔레그램 서버 연결 시도 ${attempts}회 실패: ${err.message || err}`);
          if (maxRetries > 0 && attempts >= maxRetries) {
            throw err;
          }
          const waitSec = Math.min(attempts * 3, 30);
          console.log(`⏳ ${waitSec}초 후 텔레그램 재연결을 시도합니다...`);
          await delay(waitSec * 1000);
        }
      }
    };

    bot.catch((err) => {
      console.error("[grammY] 롱폴링/메시지 처리 중 예외 발생:", err.error || err);
    });

    const me = await connectWithRetry(10);
    const s = settingsManager.getSettings();
    console.log(`🤖 Telegram Bot Connected: @${me.username} (${me.first_name})`);
    console.log(`⚙️ AI Worker: [AGY] ${s.model} (${s.mode} mode)`);
    console.log(
      `📦 GitHub Target Repo: ${config.github.owner}/${config.github.repo || "(미설정 - 로컬저장 모드)"}`
    );
    console.log("------------------------------------------");

    const pruneResult = store.pruneMessages();
    if (pruneResult.removed > 0) {
      console.log(
        `[Storage] startup prune: removed ${pruneResult.removed}, remaining ${pruneResult.remaining}`
      );
    } else {
      console.log(`[Storage] startup prune: no change (remaining ${pruneResult.remaining})`);
    }

    console.log("✅ 봇이 활성화되었습니다. 텔레그램에서 메시지를 수신 대기합니다.");

    sendStartupNotification().catch((err) => {
      console.warn("[Notification] 시작 알림 발송 중 오류:", err);
    });

    await bot.start();
  } catch (err) {
    console.error("❌ Failed to start bot:", err);
    process.exit(1);
  }
}

main();
