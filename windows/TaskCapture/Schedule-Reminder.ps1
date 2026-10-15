[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 525600)]
    [int]$Minutes,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9-]+$')]
    [string]$ReminderId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$pendingFile = Join-Path $PSScriptRoot "reminders\pending\$ReminderId.txt"
$showReminderScript = Join-Path $PSScriptRoot 'Show-Reminder.ahk'
$autoHotkeyExe = Join-Path $env:LOCALAPPDATA 'Programs\AutoHotkey\v2\AutoHotkey64.exe'
$taskName = "TaskCapture-Reminder-$ReminderId"

if (-not (Test-Path -LiteralPath $pendingFile -PathType Leaf)) {
    throw "Reminder request not found: $pendingFile"
}

if (-not (Test-Path -LiteralPath $showReminderScript -PathType Leaf)) {
    throw "Reminder display script not found: $showReminderScript"
}

if (-not (Test-Path -LiteralPath $autoHotkeyExe -PathType Leaf)) {
    throw "AutoHotkey v2 not found: $autoHotkeyExe"
}

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw "A scheduled task named '$taskName' already exists."
}

$runAt = (Get-Date).AddMinutes($Minutes)
$actionArguments = '"{0}" "{1}"' -f $showReminderScript, $ReminderId
$action = New-ScheduledTaskAction -Execute $autoHotkeyExe -Argument $actionArguments
$trigger = New-ScheduledTaskTrigger -Once -At $runAt
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'One-time TaskCapture reminder.'

Register-ScheduledTask -TaskName $taskName -InputObject $task | Out-Null
