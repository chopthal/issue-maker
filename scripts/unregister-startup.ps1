# Issue-Maker 자동 시작 해제 스크립트 (시작프로그램 폴더 + 레지스트리 동시 삭제)
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$taskName = "IssueMakerBot"
$startupFolder = [System.Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder "$taskName.lnk"

# 1. 레지스트리 삭제
Remove-ItemProperty -Path $regPath -Name $taskName -ErrorAction SilentlyContinue

# 2. 바로가기 삭제
if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
}

Write-Host "🗑️ Windows 시작프로그램(레지스트리 및 폴더)에서 Issue-Maker 등록이 해제되었습니다." -ForegroundColor Yellow
