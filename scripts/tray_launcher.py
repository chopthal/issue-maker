import os
import sys
import subprocess
import threading
import time
from PIL import Image, ImageDraw
import pystray
import ctypes
from ctypes import wintypes

PROJECT_DIR = r"C:\Software\issue-maker"
LOG_FILE = os.path.join(PROJECT_DIR, "data", "bot.log")
ENV_FILE = os.path.join(PROJECT_DIR, ".env")
NODE_APP = os.path.join(PROJECT_DIR, "dist", "index.js")

# 텔레그램 /restart 가 process.exit(42) 로 종료할 때 자동 재기동
RESTART_EXIT_CODE = 42

# Windows 단일 인스턴스 Mutex
ERROR_ALREADY_EXISTS = 183
mutex_handle = None

bot_process = None
process_lock = threading.Lock()
suppress_auto_restart = False
watcher_stop = threading.Event()


def acquire_single_instance_mutex():
    global mutex_handle
    kernel32 = ctypes.windll.kernel32
    CreateMutexW = kernel32.CreateMutexW
    CreateMutexW.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR]
    CreateMutexW.restype = wintypes.HANDLE

    mutex_name = "Global\\IssueMakerBot_Pystray_SingleInstance_Mutex"
    mutex_handle = CreateMutexW(None, True, mutex_name)
    last_error = kernel32.GetLastError()
    if last_error == ERROR_ALREADY_EXISTS:
        # 이미 다른 트레이 인스턴스가 실행 중
        sys.exit(0)


def truncate_log_if_needed(max_lines=2000):
    try:
        if not os.path.exists(LOG_FILE):
            return
        with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        if len(lines) > max_lines:
            with open(LOG_FILE, "w", encoding="utf-8") as f:
                f.writelines(lines[-max_lines:])
    except Exception:
        pass


def log_launcher(message):
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    formatted = f"[{now}] [LAUNCHER] {message}\n"
    try:
        os.makedirs(os.path.join(PROJECT_DIR, "data"), exist_ok=True)
        truncate_log_if_needed(2000)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(formatted)
    except Exception:
        pass


def create_image():
    # 64x64 보라/파랑 둥근 아이콘 생성
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((4, 4, 60, 60), radius=14, fill="#2b5278", outline="#5288c1", width=2)
    draw.rectangle((16, 20, 48, 26), fill="#ffffff")
    draw.rectangle((16, 30, 44, 36), fill="#82b1ff")
    draw.rectangle((16, 40, 36, 46), fill="#ffffff")
    return image


def start_bot():
    global bot_process, suppress_auto_restart
    with process_lock:
        if bot_process and bot_process.poll() is None:
            return

        # 혹시 남아있는 node 프로세스 정리
        try:
            subprocess.run(
                'powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name = \'node.exe\'\\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like \'*issue-maker\\dist\\index.js*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
                shell=True,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
        except Exception:
            pass

        if not os.path.exists(NODE_APP):
            log_launcher(f"오류: {NODE_APP} 파일을 찾을 수 없습니다. npm run build를 먼저 실행해주세요.")
            return

        log_launcher("Issue-Maker Bot 프로세스를 시작합니다...")
        try:
            bot_process = subprocess.Popen(
                ["node", NODE_APP],
                cwd=PROJECT_DIR,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            suppress_auto_restart = False
            log_launcher(f"Issue-Maker Bot 프로세스가 시작되었습니다. (PID: {bot_process.pid})")
        except Exception as e:
            log_launcher(f"Issue-Maker Bot 프로세스 시작 실패: {e}")


def stop_bot():
    global bot_process, suppress_auto_restart
    with process_lock:
        suppress_auto_restart = True
        if bot_process:
            pid = bot_process.pid
            log_launcher(f"Issue-Maker Bot 프로세스를 중지합니다. (PID: {pid})")
            try:
                bot_process.terminate()
                bot_process.wait(timeout=2)
            except Exception:
                try:
                    bot_process.kill()
                except Exception:
                    pass
            bot_process = None

        try:
            subprocess.run(
                'powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name = \'node.exe\'\\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like \'*issue-maker\\dist\\index.js*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
                shell=True,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
        except Exception:
            pass


def is_bot_running():
    with process_lock:
        return bot_process is not None and bot_process.poll() is None


def watch_bot_process():
    """봇 프로세스를 감시하며, 사용자가 직접 트레이에서 종료한 경우가 아니면 항상 자동 복구한다."""
    global bot_process
    crash_count = 0
    last_crash_time = 0.0

    while not watcher_stop.is_set():
        try:
            time.sleep(1)
            with process_lock:
                proc = bot_process
                suppressed = suppress_auto_restart

            if proc is None:
                continue

            code = proc.poll()
            if code is None:
                continue

            with process_lock:
                if bot_process is proc:
                    bot_process = None

            if suppressed:
                # 사용자가 트레이 메뉴에서 직접 '재시작' 또는 '종료'를 누른 경우
                continue

            if code == RESTART_EXIT_CODE:
                log_launcher("텔레그램 /restart 감지 — 즉시 봇을 재기동합니다.")
                crash_count = 0
                time.sleep(1)
                start_bot()
            else:
                now = time.time()
                # 60초 이상 정상 동작 후 꺼졌다면 크래시 카운트 초기화
                if now - last_crash_time > 60:
                    crash_count = 0
                last_crash_time = now
                crash_count += 1

                # 빈번한 크래시 시 점진적 지연 (최대 30초)
                delay = min(5 * crash_count, 30)
                log_launcher(f"⚠️ 봇 프로세스 비정상 종료 (code={code}). {delay}초 후 자동으로 복구합니다... (연속 {crash_count}회)")
                time.sleep(delay)
                if not watcher_stop.is_set():
                    start_bot()
        except Exception as e:
            log_launcher(f"감시 루프 오류: {e}")
            time.sleep(2)


def restart_bot(icon=None, item=None):
    log_launcher("봇 재시작 요청을 수신했습니다.")
    stop_bot()
    time.sleep(1)
    start_bot()
    if icon:
        icon.notify("Issue-Maker 봇이 재시작되었습니다.", "Issue-Maker")


def open_log(icon=None, item=None):
    if os.path.exists(LOG_FILE):
        os.startfile(LOG_FILE)


def open_env(icon=None, item=None):
    if os.path.exists(ENV_FILE):
        os.startfile(ENV_FILE)


def open_folder(icon=None, item=None):
    os.startfile(PROJECT_DIR)


def on_exit(icon, item):
    log_launcher("Issue-Maker 트레이 런처를 종료합니다.")
    watcher_stop.set()
    stop_bot()
    icon.stop()
    if mutex_handle:
        ctypes.windll.kernel32.CloseHandle(mutex_handle)


def main():
    acquire_single_instance_mutex()
    log_launcher("Issue-Maker 트레이 런처가 시작되었습니다.")
    start_bot()

    watcher = threading.Thread(target=watch_bot_process, name="BotWatcher", daemon=True)
    watcher.start()

    menu = pystray.Menu(
        pystray.MenuItem(lambda item: f"Issue-Maker Bot ({'실행 중' if is_bot_running() else '중지됨'})", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("📋 로그 보기 (bot.log)", open_log, default=True),
        pystray.MenuItem("⚙️ .env 설정 열기", open_env),
        pystray.MenuItem("🔄 봇 재시작 (Restart)", restart_bot),
        pystray.MenuItem("📁 프로젝트 폴더 열기", open_folder),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("❌ 종료 (Exit)", on_exit)
    )

    icon = pystray.Icon("IssueMakerBot", create_image(), "Issue-Maker Bot", menu)
    icon.run()


if __name__ == "__main__":
    main()
