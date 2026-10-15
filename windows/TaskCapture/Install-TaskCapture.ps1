# Install the TaskCapture hotkeys (quick Obsidian todo + reminders) on Windows.
# Copies the scripts to a Windows-local folder, adds a Startup shortcut, and starts them.
#
# Run from Windows PowerShell:
#   powershell -NoProfile -ExecutionPolicy Bypass -File "\\wsl.localhost\Ubuntu-24.04\home\<you>\dotfiles\windows\TaskCapture\Install-TaskCapture.ps1"

[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:USERPROFILE 'scripts\TaskCapture')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sourceDir = Split-Path -Parent $PSCommandPath
$files = @(
    'TaskCapture.ahk',
    'Add-ObsidianTask.ps1',
    'Schedule-Reminder.ps1',
    'Show-Reminder.ahk'
)
$autoHotkeyExe = Join-Path $env:LOCALAPPDATA 'Programs\AutoHotkey\v2\AutoHotkey64.exe'
$inboxPath = 'C:\Obsidian\Task_Inbox_Vault\Task Inbox.md'

if (-not (Test-Path -LiteralPath $autoHotkeyExe -PathType Leaf)) {
    throw "AutoHotkey v2 not found at $autoHotkeyExe. Install it first: winget install --id AutoHotkey.AutoHotkey --scope user"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'requests') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'reminders\pending') | Out-Null

foreach ($file in $files) {
    $source = Join-Path $sourceDir $file
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Missing source file: $source"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $InstallDir $file) -Force
}

$mainScript = Join-Path $InstallDir 'TaskCapture.ahk'
$startupDir = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDir 'TaskCapture.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $autoHotkeyExe
$shortcut.Arguments = '"' + $mainScript + '"'
$shortcut.WorkingDirectory = $InstallDir
$shortcut.Save()

# #SingleInstance Force replaces any copy that is already running.
Start-Process -FilePath $autoHotkeyExe -ArgumentList ('"' + $mainScript + '"') -WorkingDirectory $InstallDir

Write-Host "TaskCapture installed to $InstallDir"
Write-Host "Startup shortcut: $shortcutPath"
Write-Host ''
Write-Host 'Hotkeys:'
Write-Host '  Win+Shift+T   Quick task -> Obsidian Task Inbox'
Write-Host '  Win+Shift+R   Reminder in N minutes (Windows Task Scheduler)'
Write-Host '  Win+Shift+D/I Open Task Inbox in Obsidian'
Write-Host '  Ctrl+Shift+H  Dictation cleanup (needs WSL ~/dotfiles/dictation)'

if (-not (Test-Path -LiteralPath $inboxPath -PathType Leaf)) {
    Write-Warning "Task inbox not found at $inboxPath. Quick tasks will fail until the vault exists there with its Do Now, Do Later, and Do Way Later headings."
}
