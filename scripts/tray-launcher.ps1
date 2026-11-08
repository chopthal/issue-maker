Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$projectDir = "C:\Software\issue-maker"
$logFile = Join-Path $projectDir "data\bot.log"
$envFile = Join-Path $projectDir ".env"
$nodeApp = Join-Path $projectDir "dist\index.js"

$script:botProcess = $null

function Start-Bot {
    if ($script:botProcess -and -not $script:botProcess.HasExited) {
        return
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "node.exe"
    $psi.Arguments = "`"$nodeApp`""
    $psi.WorkingDirectory = $projectDir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $dataDir = Join-Path $projectDir "data"
    if (-not (Test-Path $dataDir)) {
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    }

    $script:botProcess = [System.Diagnostics.Process]::Start($psi)

    if ($trayIcon) {
        $trayIcon.Text = "Issue-Maker (Running)"
    }
}

function Stop-Bot {
    if ($script:botProcess -and -not $script:botProcess.HasExited) {
        try {
            $script:botProcess.Kill()
            $script:botProcess.WaitForExit(2000)
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
