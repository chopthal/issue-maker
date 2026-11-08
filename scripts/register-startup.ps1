# Issue-Maker 자동 시작 등록 스크립트 (Startup 폴더 바로가기 방식)
$taskName = "IssueMakerBot"
$startupFolder = [System.Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder "$taskName.lnk"

# 1. Run 레지스트리는 중복 실행 방지를 위해 확실히 삭제 (Startup 폴더 방식 하나로 통일)
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
Remove-ItemProperty -Path $regPath -Name $taskName -ErrorAction SilentlyContinue

# 2. Startup 폴더에 pythonw 바로가기 생성
$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "C:\Software\issue-maker\.venv\Scripts\pythonw.exe"
$shortcut.Arguments = "`"C:\Software\issue-maker\scripts\tray_launcher.py`""
$shortcut.WorkingDirectory = "C:\Software\issue-maker"
$shortcut.Description = "Issue-Maker Tray Launcher"
$shortcut.Save()

Write-Host "✅ Issue-Maker가 Windows 시작프로그램에 단일 등록되었습니다!" -ForegroundColor Green
Write-Host "📍 바로가기: $shortcutPath"
