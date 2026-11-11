# Issue-Maker 🚀

텔레그램에서 기획자와 개발자가 자유롭게 나눈 대화를 분석하여 **GitHub Issue**를 원샷으로 자동 발행하고, **T3 Code** 등 AI 코딩 에이전트에 원클릭으로 투입할 수 있는 프롬프트를 생성해주는 로컬 데몬 파이프라인입니다.

---

## 💡 핵심 기능

1. **텔레그램 대화 분석 & 이슈 생성**:
   * 기획자/개발자의 대화·스크린샷(사진)을 취합해 AGY가 스펙 이슈로 정리.
   * 사진은 요약 시에만 모델(vision)로 전달하고, Issue 본문에는 **텍스트 설명만** 반영 (이미지 첨부 없음).
   * 잡담 필터링 + Decision Log + Acceptance Criteria + Tasks 체크리스트.
   * 등록 완료 후 **T3 Code 원클릭 프롬프트** (`gh issue view N 파악 및 논의. 답변은 한국어로.`) 회신.
2. **실시간 모델 변경 (AGY 전용)**:
   * `/settings` 또는 `/model`로 Gemini 3.8 Flash / Gemini 4 Argon (low·medium·high) 선택.
3. **Windows 시스템 트레이 & 무인 자동 시작**:
   * 콘솔 창 없이 백그라운드 상주.
   * 부팅 시 단일 인스턴스 자동 시작 (Win32 Mutex 보호).

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

# AGY 기본 모델 (effort는 모델명에 포함)
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
| `/preview` | Issue 등록 없이 초안만 텔레그램에 표시 (체크포인트·제외 목록 유지) |
| **(답장으로) `/summary` `/preview`** | 답장한 메시지부터 현재까지 구간만 처리 |
| **(답장으로) `/exclude`** | 해당 메시지를 이슈 대상에서 제외/해제 (토글) |
| `/excludes` | 현재 제외 메시지 목록 조회 |
| `/clearexclude` | 제외 목록 초기화 |
| `/cancel` | 진행 중인 `/summary` 또는 `/preview` 취소 |
| `/checkpoint` | 현재 기록된 마지막 체크포인트 메시지 ID 조회 |
| `/resetcheckpoint` | 체크포인트를 초기화하여 전체 대화를 대상으로 설정 |
| `/help` (또는 `/start`) | 사용 가이드 안내 |

### 2. 모델 설정 (AGY)
| 명령어 | 설명 |
|---|---|
| `/settings` | 인라인 버튼으로 모델 선택 |
| `/model <모델명>` | 모델 직접 지정 |

**선택 가능 모델**
- `gemini-3.8-flash-low` / `medium` / `high`
- `gemini-4-argon-low` / `medium` / `high`

### 3. 상태·운영
| 명령어 | 설명 |
|---|---|
| `/status` | 모델, 저장소, 체크포인트, 업타임, 작업 상태 |
| `/ping` | 생존 확인 + 응답 지연(ms) |
| `/chatid` | 현재 채팅방 ID 출력 (`ALLOWED_CHAT_IDS`용) |
| `/last` | 이 방에서 마지막 생성 이슈 링크/정보 |
| `/restart` | 봇 재시작 (트레이 런처가 exit code 42를 감지해 자동 재기동) |

---

## 📚 기술 문서
* [Windows 백그라운드 트레이 런처 및 자동 시작 아키텍처 가이드](docs/windows-tray-and-startup-guide.md): 윈도우 환경에서의 무음 백그라운드 구동, 단일 인스턴스(Win32 Mutex), 시작프로그램 등록 시 시행착오 및 해결책 정리.
