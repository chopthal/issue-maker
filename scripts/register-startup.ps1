# Issue-Maker 자동 시작 등록 스크립트 (Windows 시작프로그램 등록)
$startupFolder = [System.Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder "IssueMakerBot.lnk"
$targetScript = "C:\Software\issue-maker\scripts\start-silent.vbs"

$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"$targetScript`""
$shortcut.WorkingDirectory = "C:\Software\issue-maker"
$shortcut.Description = "Issue-Maker Telegram Bot Auto-Starter"
$shortcut.Save()

Write-Host "✅ Issue-Maker가 Windows 시작프로그램에 등록되었습니다!" -ForegroundColor Green
Write-Host "📍 바로가기 경로: $shortcutPath"
Write-Host "ℹ️ 이제 PC를 켜고 로그인하면 검은 창 없이 백그라운드에서 자동 실행됩니다."
