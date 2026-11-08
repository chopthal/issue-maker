# Issue-Maker 자동 시작 해제 스크립트
$startupFolder = [System.Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder "IssueMakerBot.lnk"

if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Host "🗑️ Windows 시작프로그램에서 Issue-Maker 등록이 해제되었습니다." -ForegroundColor Yellow
} else {
    Write-Host "ℹ️ 등록된 시작프로그램 바로가기가 없습니다."
}
