# Copy dictation launcher files from WSL/dotfiles to a Windows-local folder.
# This avoids slow startup from \\wsl.localhost paths.

[CmdletBinding()]
param(
    [string]$InstallDir = "$env:LOCALAPPDATA\DictationCleanup"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$sourceDir = Split-Path -Parent $PSCommandPath
$files = @(
    "dictation-cleanup.ps1",
    "dictation-cleanup-hidden.vbs"
)

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

foreach ($file in $files) {
    $source = Join-Path $sourceDir $file
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Missing source file: $source"
    }

    Copy-Item -LiteralPath $source -Destination (Join-Path $InstallDir $file) -Force
}

$launcher = Join-Path $InstallDir "dictation-cleanup-hidden.vbs"
$shortcutTarget = "wscript.exe `"$launcher`""

Write-Host "Dictation launcher installed to:"
Write-Host "  $InstallDir"
Write-Host ""
Write-Host "Create a Windows shortcut with this target:"
Write-Host "  $shortcutTarget"
Write-Host ""
Write-Host "Recommended shortcut key:"
Write-Host "  Ctrl + Alt + H"
Write-Host ""
Write-Host "Debug command if needed:"
Write-Host "  powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'dictation-cleanup.ps1')`""
