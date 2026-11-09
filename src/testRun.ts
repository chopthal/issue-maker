import { MessageStore, ChatMessage } from "./storage/db.js";
import { runSynthesisPipeline } from "./workers/pipeline.js";

async function runMockTest() {
  console.log("🧪 모의 대화 데이터로 원샷(One-Shot) 파이프라인 검증 시작...\n");

  const mockMessages: ChatMessage[] = [
    {
      id: 101,
      chatId: 9999,
      sender: "기획자 김지우",
      senderId: 1,
      date: "2026-11-09 10:00:00",
      text: "사용자가 소셜 로그인할 때 바로 가입 완료되지 않고 닉네임이랑 관심사 태그를 입력받는 온보딩 모달을 띄웠으면 좋겠어요.",
    },
    {
      id: 102,
      chatId: 9999,
      sender: "개발자 박동현",
      senderId: 2,
      date: "2026-11-09 10:02:15",
      text: "그럼 카카오/구글 OAuth 콜백 이후 우리 DB에 is_profile_completed 플래그를 두고, 이게 false면 프론트에서 온보딩 모달을 띄우는 걸로 가죠.",
    },
    {
      id: 103,
      chatId: 9999,
      sender: "기획자 김지우",
      senderId: 1,
      date: "2026-11-09 10:03:00",
      text: "좋아요! 그리고 관심사 태그는 최소 1개, 최대 5개까지만 선택 가능하게 제한해주세요. UI는 칩 형태입니다.",
    },
    {
      id: 104,
      chatId: 9999,
      sender: "개발자 박동현",
      senderId: 2,
      date: "2026-11-09 10:05:30",
      text: "네. 점심 뭐 드실래요? 1층 김치찌개 어때요?",
    },
    {
      id: 105,
      chatId: 9999,
      sender: "기획자 김지우",
      senderId: 1,
      date: "2026-11-09 10:06:00",
      text: "ㅋㅋㅋ 좋습니다. 아 그리고 닉네임 실시간 중복 체크 API도 꼭 필요합니다 (2~10자 한글/영문).",
    },
  ];

  const store = new MessageStore();
  const formatted = store.formatMessagesForPrompt(mockMessages);

  console.log("--- [포맷팅된 원본 대화 (잡담 포함)] ---");
  console.log(formatted);
  console.log("------------------------------------------\n");

  console.log("⏳ 원샷 AI 파이프라인 실행 중...");
  const result = await runSynthesisPipeline(formatted, (step) => {
    console.log(` > ${step}`);
  });

  console.log("\n==========================================");
  console.log(`🎉 파이프라인 완료! (소요 시간: ${Math.round(result.processingTimeMs / 1000)}초 | 모델: ${result.model})`);
  console.log("==========================================");
  console.log(`\n📌 TITLE: ${result.issue.title}\n`);
  console.log(result.issue.body);
}

runMockTest().catch(console.error);
