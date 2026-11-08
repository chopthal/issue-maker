import { Bot } from "grammy";
import { config } from "./config.js";
import { registerHandlers } from "./bot/handlers.js";

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

  // 핸들러 등록
  registerHandlers(bot);

  // Graceful shutdown
  const stop = () => {
    console.log("\n🛑 Stopping Issue-Maker Bot Server...");
    bot.stop();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const me = await bot.api.getMe();
    console.log(`🤖 Telegram Bot Connected: @${me.username} (${me.first_name})`);
    console.log(`⚙️ AI Worker: [${config.worker.engine.toUpperCase()}] ${config.worker.model} (${config.worker.mode} mode)`);
    console.log(`📦 GitHub Target Repo: ${config.github.owner}/${config.github.repo || "(미설정 - 로컬저장 모드)"}`);
    console.log("------------------------------------------");
    console.log("✅ 봇이 활성화되었습니다. 텔레그램에서 메시지를 수신 대기합니다.");

    await bot.start();
  } catch (err) {
    console.error("❌ Failed to start bot:", err);
    process.exit(1);
  }
}

main();
