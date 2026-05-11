# Dictation cleanup popup for Windows + WSL.
# No AutoHotkey required. Create a Windows shortcut to this script and assign Ctrl+Alt+H.

[CmdletBinding()]
param(
    [string]$WslDistro = "",
    [string]$WslScript = "",
    [string]$DefaultMode = "light",
    [string]$Provider = "openrouter",
    [string]$Model = "qwen/qwen3.5-9b"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeWindowFocus {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

function ConvertTo-WslPath {
    param([Parameter(Mandatory)][string]$WindowsPath)
    $fullPath = [System.IO.Path]::GetFullPath($WindowsPath)
    if ($fullPath -notmatch '^([A-Za-z]):\\(.*)$') {
        throw "Only local drive paths can be converted to WSL paths: $fullPath"
    }
    $drive = $Matches[1].ToLowerInvariant()
    $rest = $Matches[2].Replace('\', '/')
    return "/mnt/$drive/$rest"
}

function ConvertFrom-WslUncPath {
    param([Parameter(Mandatory)][string]$Path)
    $normalized = $Path.Replace('/', '\')
    if ($normalized -match '^\\\\wsl(?:\.localhost|\$)\\[^\\]+(?<linux>\\.*)$') {
        return $Matches['linux'].Replace('\', '/')
    }
    return $null
}

function Resolve-WslScriptPath {
    param([string]$ConfiguredPath)

    if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) {
        return $ConfiguredPath
    }

    $scriptPath = $PSCommandPath
    $linuxScriptPath = ConvertFrom-WslUncPath $scriptPath
    if ($linuxScriptPath) {
        $repoRoot = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetDirectoryName($linuxScriptPath)).Replace('\', '/')
        return "$repoRoot/dictation/cleanup-dictation"
    }

    return "~/dotfiles/dictation/cleanup-dictation"
}

function Quote-Bash {
    param([Parameter(Mandatory)][string]$Value)
    if ($Value.StartsWith('~/')) {
        $rest = $Value.Substring(2)
        return "~/" + "'" + $rest.Replace("'", "'\''") + "'"
    }
    return "'" + $Value.Replace("'", "'\''") + "'"
}

function Invoke-WslCleanup {
    param(
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)][string]$Mode
    )

    $tempIn = [System.IO.Path]::GetTempFileName()
    $tempOut = [System.IO.Path]::GetTempFileName()
    $tempErr = [System.IO.Path]::GetTempFileName()

    try {
        [System.IO.File]::WriteAllText($tempIn, $Text, [System.Text.UTF8Encoding]::new($false))
        $wslInput = ConvertTo-WslPath $tempIn
        $resolvedWslScript = Resolve-WslScriptPath $WslScript
        $providerAssignment = "DICTATION_CLEANUP_PROVIDER=" + (Quote-Bash $Provider)
        $modelAssignment = "DICTATION_CLEANUP_MODEL=" + (Quote-Bash $Model)
        $command = "$providerAssignment $modelAssignment $(Quote-Bash $resolvedWslScript) --mode $(Quote-Bash $Mode) < $(Quote-Bash $wslInput)"

        $arguments = @()
        if ($WslDistro.Trim() -ne "") {
            $arguments += @("-d", $WslDistro)
        }
        $arguments += @("bash", "-lc", $command)

        & wsl.exe @arguments > $tempOut 2> $tempErr
        $exitCode = $LASTEXITCODE
        $stdout = [System.IO.File]::ReadAllText($tempOut).Trim()
        $stderr = [System.IO.File]::ReadAllText($tempErr).Trim()

        if ($exitCode -ne 0) {
            if ([string]::IsNullOrWhiteSpace($stderr)) {
                $stderr = "wsl.exe exited with code $exitCode"
            }
            throw $stderr
        }

        return $stdout
    }
    finally {
        Remove-Item -LiteralPath $tempIn, $tempOut, $tempErr -Force -ErrorAction SilentlyContinue
    }
}

$previousWindow = [NativeWindowFocus]::GetForegroundWindow()

$form = New-Object System.Windows.Forms.Form
$form.Text = "Dictation Cleanup"
$form.Size = New-Object System.Drawing.Size(600, 380)
$form.MinimumSize = New-Object System.Drawing.Size(520, 320)
$form.StartPosition = "CenterScreen"
$form.TopMost = $true
$form.KeyPreview = $true
$form.BackColor = [System.Drawing.Color]::FromArgb(248, 249, 251)
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9)

$instructions = New-Object System.Windows.Forms.Label
$instructions.AutoSize = $false
$instructions.Location = New-Object System.Drawing.Point(16, 14)
$instructions.Size = New-Object System.Drawing.Size(552, 36)
$instructions.ForeColor = [System.Drawing.Color]::FromArgb(55, 65, 81)
$instructions.Text = "Dictate or type below. Press Ctrl+Enter to clean and paste into the previous app."
$form.Controls.Add($instructions)

$modeLabel = New-Object System.Windows.Forms.Label
$modeLabel.AutoSize = $true
$modeLabel.Location = New-Object System.Drawing.Point(16, 54)
$modeLabel.ForeColor = [System.Drawing.Color]::FromArgb(75, 85, 99)
$modeLabel.Text = "Mode"
$form.Controls.Add($modeLabel)

$mode = New-Object System.Windows.Forms.ComboBox
$mode.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
[void]$mode.Items.Add("Light cleanup")
[void]$mode.Items.Add("Polish")
$mode.SelectedIndex = if ($DefaultMode -eq "polish") { 1 } else { 0 }
$mode.Location = New-Object System.Drawing.Point(62, 50)
$mode.Width = 160
$form.Controls.Add($mode)

$textBox = New-Object System.Windows.Forms.TextBox
$textBox.Multiline = $true
$textBox.AcceptsReturn = $true
$textBox.AcceptsTab = $true
$textBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$textBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$textBox.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$textBox.Location = New-Object System.Drawing.Point(16, 84)
$textBox.Size = New-Object System.Drawing.Size(552, 200)
$form.Controls.Add($textBox)

$status = New-Object System.Windows.Forms.Label
$status.AutoSize = $false
$status.Location = New-Object System.Drawing.Point(16, 298)
$status.Size = New-Object System.Drawing.Size(408, 28)
$status.ForeColor = [System.Drawing.Color]::FromArgb(75, 85, 99)
$status.Text = "Ready"
$form.Controls.Add($status)

$button = New-Object System.Windows.Forms.Button
$button.Text = "Clean + Paste"
$button.Location = New-Object System.Drawing.Point(444, 294)
$button.Size = New-Object System.Drawing.Size(124, 34)
$button.BackColor = [System.Drawing.Color]::FromArgb(37, 99, 235)
$button.ForeColor = [System.Drawing.Color]::White
$button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$button.FlatAppearance.BorderSize = 0
$form.Controls.Add($button)
$form.AcceptButton = $button

$submit = {
    if ([string]::IsNullOrWhiteSpace($textBox.Text)) {
        $status.Text = "Enter or dictate text before submitting."
        return
    }

    $selectedMode = if ($mode.SelectedItem -eq "Polish") { "polish" } else { "light" }
    $status.Text = "Cleaning with WSL/pi..."
    $form.Refresh()

    try {
        $cleaned = Invoke-WslCleanup -Text $textBox.Text -Mode $selectedMode
        if ([string]::IsNullOrWhiteSpace($cleaned)) {
            $status.Text = "Cleanup returned empty text. Popup left open."
            return
        }

        [System.Windows.Forms.Clipboard]::SetText($cleaned)
        if ($previousWindow -ne [IntPtr]::Zero) {
            [void][NativeWindowFocus]::SetForegroundWindow($previousWindow)
            Start-Sleep -Milliseconds 150
            [System.Windows.Forms.SendKeys]::SendWait('^v')
        }
        $form.Close()
    }
    catch {
        $status.Text = "Error: $($_.Exception.Message)"
    }
}

$button.Add_Click($submit)
$form.Add_KeyDown({
    if ($_.Control -and $_.KeyCode -eq [System.Windows.Forms.Keys]::Enter) {
        & $submit
        $_.SuppressKeyPress = $true
    }
})
$form.Add_Resize({
    $client = $form.ClientSize
    $instructions.Width = [Math]::Max(300, $client.Width - 32)
    $textBox.Width = [Math]::Max(300, $client.Width - 32)
    $textBox.Height = [Math]::Max(120, $client.Height - 180)
    $status.Top = $client.Height - 44
    $status.Width = [Math]::Max(200, $client.Width - 180)
    $button.Left = $client.Width - 140
    $button.Top = $client.Height - 48
})
$form.Add_Shown({ $textBox.Focus() })

[void]$form.ShowDialog()
