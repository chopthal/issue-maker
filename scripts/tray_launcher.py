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

# Windows 단일 인스턴스 Mutex
ERROR_ALREADY_EXISTS = 183
mutex_handle = None

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

bot_process = None
process_lock = threading.Lock()

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
    global bot_process
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

        os.makedirs(os.path.join(PROJECT_DIR, "data"), exist_ok=True)
        log_fp = open(LOG_FILE, "a", encoding="utf-8")

        bot_process = subprocess.Popen(
            ["node", NODE_APP],
            cwd=PROJECT_DIR,
            stdout=log_fp,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW
        )

def stop_bot():
    global bot_process
    with process_lock:
        if bot_process:
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

def restart_bot(icon=None, item=None):
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
    stop_bot()
    icon.stop()
    if mutex_handle:
        ctypes.windll.kernel32.CloseHandle(mutex_handle)

def main():
    acquire_single_instance_mutex()
    start_bot()

    menu = pystray.Menu(
        pystray.MenuItem("Issue-Maker Bot (실행 중)", None, enabled=False),
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
