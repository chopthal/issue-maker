# Issue-Maker 🚀

텔레그램에서 기획자와 개발자가 자유롭게 나눈 대화를 분석하여 **GitHub Issue**를 원샷으로 자동 발행하고, **T3 Code** 등 AI 코딩 에이전트에 원클릭으로 투입할 수 있는 프롬프트를 생성해주는 로컬 데몬 파이프라인입니다.

---

## 💡 핵심 기능

1. **텔레그램 대화 분석 & 이슈 생성**:
   * 기획자/개발자의 대화, 스크린샷, 기술 제약사항을 실시간으로 취합.
   * 잡담/농담 100% 필터링 + 의사결정(Decision Log) 추적.
   * Given-When-Then 인수조건(AC) + 작업 분할(Tasks) 체크리스트를 포함한 정식 GitHub Issue 자동 등록.
   * 등록 완료 후 **T3 Code 원클릭 프롬프트** 즉시 회신.
2. **실시간 LLM 공급사 / 모델 / Effort 변경**:
   * 텔레그램 채팅방에서 `/설정` 명령어나 인라인 버튼으로 **공급사(AGY / Cursor / OpenAI)**, **모델명**, **Effort(추론 강도)**를 즉시 변경 가능.
3. **Windows 시스템 트레이 & 무인 자동 시작**:
   * 콘솔 창 없이 백그라운드 상주.
   * 부팅 시 단일 인스턴스 자동 시작 (Win32 Mutex 보호).
   * 트레이 아이콘 우클릭으로 로그 확인, 설정 열기, 봇 재시작 가능.

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

# 기본 AI 워커 설정
WORKER_ENGINE=agy
WORKER_MODEL=gemini-3.8-flash-low
```

### 2. 빌드 및 실행
```bash
# 빌드
npm run build

# 트레이 런처와 함께 백그라운드 실행
.\run_tray.bat

# 또는 콘솔 직접 실행
npm start
```

### 3. Windows 부팅 시 자동 시작 등록
```powershell
powershell -ExecutionPolicy Bypass -File "scripts\register-startup.ps1"
```

---

## 💬 텔레그램 명령어 안내

### 1. 대화 정리 및 이슈 생성
| 명령어 | 설명 |
|---|---|
| `/summary` or `여기까지 정리` | 직전 체크포인트 이후의 대화를 취합하여 원샷 이슈 생성 |
| **(답장으로) `/summary`** | 답장한 메시지부터 현재까지 구간을 취합하여 원샷 이슈 생성 |
| `/checkpoint` | 현재 기록된 마지막 체크포인트 메시지 ID 조회 |
| `/resetcheckpoint` | 체크포인트를 초기화하여 전체 대화를 대상으로 설정 |
| `/help` (또는 `/start`) | 사용 가이드 안내 |

### 2. LLM 엔진 / 모델 / Effort 실시간 제어
| 명령어 | 설명 |
|---|---|
| `/settings` | 인라인 버튼 UI로 공급사/모델/effort 대화형 변경 |
| `/engine agy` \| `cursor` \| `openai` | 공급사 즉시 변경 |
| `/model <모델명>` | 모델명 직접 지정 (예: `/model gemini-4-argon-medium`) |
| `/effort low` \| `medium` \| `high` \| `max` | 추론 강도(Effort) 변경 (AGY 지원) |
| `/mode plan` \| `auto` | 실행 모드 변경 |

---

## 📚 기술 문서
* [Windows 백그라운드 트레이 런처 및 자동 시작 아키텍처 가이드](docs/windows-tray-and-startup-guide.md): 윈도우 환경에서의 무음 백그라운드 구동, 단일 인스턴스(Win32 Mutex), 시작프로그램 등록 시 시행착오 및 해결책 정리.
