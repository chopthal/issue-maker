Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# 1. 중복 실행 방지 (Global Mutex)
$mutexName = "Global\IssueMakerBot_SingleInstance_Mutex"
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)

if (-not $createdNew) {
    # 이미 다른 트레이 인스턴스가 실행 중이면 조용히 종료
    exit 0
}

$projectDir = "C:\Software\issue-maker"
$logFile = Join-Path $projectDir "data\bot.log"
$envFile = Join-Path $projectDir ".env"
$nodeApp = Join-Path $projectDir "dist\index.js"

$script:botProcess = $null

function Start-Bot {
    if ($script:botProcess -and -not $script:botProcess.HasExited) {
        return
    }

    # 기존에 돌고 있을 수 있는 잔여 node.exe 프로세스 정리
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*issue-maker\dist\index.js*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

    Start-Sleep -Milliseconds 500

    $dataDir = Join-Path $projectDir "data"
    if (-not (Test-Path $dataDir)) {
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd.exe"
    # cmd /c node dist\index.js >> data\bot.log 2>&1 형태로 로그 누적
    $psi.Arguments = "/c node `"$nodeApp`" >> `"$logFile`" 2>&1"
    $psi.WorkingDirectory = $projectDir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $script:botProcess = [System.Diagnostics.Process]::Start($psi)

    if ($trayIcon) {
        $trayIcon.Text = "Issue-Maker (Running)"
    }
}

function Stop-Bot {
    if ($script:botProcess -and -not $script:botProcess.HasExited) {
        try {
            $script:botProcess.Kill()
            $script:botProcess.WaitForExit(1000)
        } catch {}
    }
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*issue-maker\dist\index.js*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Restart-Bot {
    Stop-Bot
    Start-Sleep -Seconds 1
    Start-Bot
}

# Tray icon
$trayIcon = New-Object System.Windows.Forms.NotifyIcon
$trayIcon.Text = "Issue-Maker (Running)"
$trayIcon.Visible = $true
$trayIcon.Icon = [System.Drawing.SystemIcons]::Application

# Context menu
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

$statusItem = $contextMenu.Items.Add("Issue-Maker Bot")
$statusItem.Enabled = $false

$contextMenu.Items.Add("-") | Out-Null

$logItem = $contextMenu.Items.Add("View Log (bot.log)")
$logItem.add_Click({
    if (Test-Path $logFile) {
        Start-Process "notepad.exe" -ArgumentList "`"$logFile`""
    } else {
        [System.Windows.Forms.MessageBox]::Show("Log file not found yet.", "Issue-Maker")
    }
})

$envItem = $contextMenu.Items.Add("Open .env Settings")
$envItem.add_Click({
    if (Test-Path $envFile) {
        Start-Process "notepad.exe" -ArgumentList "`"$envFile`""
    } else {
        [System.Windows.Forms.MessageBox]::Show(".env file not found.", "Issue-Maker")
    }
})

$restartItem = $contextMenu.Items.Add("Restart Bot")
$restartItem.add_Click({
    Restart-Bot
})

$folderItem = $contextMenu.Items.Add("Open Project Folder")
$folderItem.add_Click({
    Start-Process "explorer.exe" -ArgumentList "`"$projectDir`""
})

$contextMenu.Items.Add("-") | Out-Null

$exitItem = $contextMenu.Items.Add("Exit")
$exitItem.add_Click({
    Stop-Bot
    $trayIcon.Visible = $false
    $trayIcon.Dispose()
    $mutex.ReleaseMutex()
    $mutex.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$trayIcon.ContextMenuStrip = $contextMenu

$trayIcon.add_DoubleClick({
    if (Test-Path $logFile) {
        Start-Process "notepad.exe" -ArgumentList "`"$logFile`""
    }
})

Start-Bot

[System.Windows.Forms.Application]::Run()
