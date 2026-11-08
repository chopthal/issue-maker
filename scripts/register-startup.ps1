# Issue-Maker 자동 시작 등록 스크립트 (Windows Run 레지스트리 단일 등록)
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$taskName = "IssueMakerBot"
$cmdValue = 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Software\issue-maker\scripts\tray-launcher.ps1"'

# 1. Windows Run 레지스트리에 단일 등록 (작업 관리자 시작 앱 목록에 표시)
Set-ItemProperty -Path $regPath -Name $taskName -Value $cmdValue

# 2. 혹시 남아있을 수 있는 Startup 폴더 내 중복 바로가기 정리 (중복 실행 원천 차단)
$startupFolder = [System.Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder "$taskName.lnk"
if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
}

Write-Host "✅ Issue-Maker가 Windows 시작프로그램(레지스트리 단일 항목)으로 등록되었습니다!" -ForegroundColor Green
Write-Host "📍 레지스트리: $regPath -> $taskName"
