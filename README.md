# Issue-Maker 🚀

텔레그램에서 기획자와 개발자가 자유롭게 나눈 대화를 분석하여 **GitHub Issue**를 원샷으로 자동 발행하고, **T3 Code** 등 AI 코딩 에이전트에 원클릭으로 투입할 수 있는 프롬프트를 생성해주는 로컬 데몬 파이프라인입니다.

---

## 💡 핵심 워크플로우

1. **텔레그램 대화**: 기획자와 개발자가 텍스트, 스크린샷, 제약사항 등을 편하게 논의합니다.
2. **정리 트리거**:
   * `/정리` (또는 대화 중 *"여기까지 정리"*): 직전 체크포인트 이후부터 현재까지 자동 수집
   * **특정 메시지에 '답장'으로 `/정리`**: 해당 메시지부터 현재까지 구간 정밀 수집
3. **One-Shot AI 파이프라인**:
   * 복잡한 다단계 체이닝 없이, 고성능 모델(`gemini-3.8-flash-low`, `gpt-6-luna`, `cursor-auto` 등)이 원본 대화 전체를 직접 분석.
   * 잡담/농담 100% 필터링 + 기획자/개발자 의사결정 추적 + Given-When-Then 인수조건(AC) + 작업 분할(Tasks) 체크리스트를 **단 한 번의 호출(5~10초)**로 완성!
4. **결과 피드백**:
   * GitHub에 Issue 등록
   * 텔레그램 채팅방으로 이슈 링크 + **"T3 Code 원클릭 프롬프트"** 회신

---

## 🛠️ 시작하기 (Quick Start)

### 1. 환경 설정
프로젝트 루트에 `.env` 파일을 생성합니다:
```bash
cp .env.example .env
```
`.env` 파일에 텔레그램 봇 토큰과 GitHub 토큰을 입력합니다:
```env
TELEGRAM_BOT_TOKEN=your_bot_token
GITHUB_TOKEN=ghp_your_token
GITHUB_OWNER=your_github_username
GITHUB_REPO=your_repository_name

# AI 워커 선택 (기본: agy gemini-3.8-flash-low)
WORKER_ENGINE=agy
WORKER_MODEL=gemini-3.8-flash-low
```

### 2. 빌드 및 테스트
```bash
# 파이프라인 모의 테스트
npm run test:pipeline

# 봇 서버 실행
npm start
```

---

## 💬 텔레그램 명령어 안내

| 명령어 | 설명 |
|---|---|
| `/정리` or `여기까지 정리` | 직전 체크포인트 이후의 대화를 취합하여 원샷 이슈 생성 |
| **(답장으로) `/정리`** | 답장한 메시지부터 현재까지 구간을 취합하여 원샷 이슈 생성 |
| `/체크포인트` | 현재 기록된 마지막 체크포인트 메시지 ID 조회 |
| `/체크포인트초기화` | 체크포인트를 초기화하여 다음 `/정리` 시 전체 대화를 대상으로 설정 |
| `/도움말` | 사용 가이드 안내 |
