# Issue-Maker 자동 시작 등록 스크립트 (시작프로그램 폴더 + Windows 레지스트리 동시 등록)
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$taskName = "IssueMakerBot"
$targetScript = "C:\Software\issue-maker\scripts\start-silent.vbs"
$cmdValue = "wscript.exe `"$targetScript`""

# 1. Windows Run 레지스트리 등록 (작업 관리자 시작프로그램 탭에 즉시 표시됨)
Set-ItemProperty -Path $regPath -Name $taskName -Value $cmdValue

# 2. 시작프로그램 폴더 바로가기 생성
$startupFolder = [System.Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder "$taskName.lnk"
$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"$targetScript`""
$shortcut.WorkingDirectory = "C:\Software\issue-maker"
$shortcut.Description = "Issue-Maker Telegram Bot Auto-Starter"
$shortcut.Save()

Write-Host "✅ Issue-Maker가 Windows 시작프로그램(레지스트리 및 폴더)에 등록되었습니다!" -ForegroundColor Green
Write-Host "📍 레지스트리: $regPath -> $taskName"
Write-Host "📍 바로가기: $shortcutPath"
