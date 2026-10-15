[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RequestFile,

    [Parameter(Mandatory = $true)]
    [ValidateSet('now', 'later', 'way-later')]
    [string]$Urgency,

    [Parameter(Mandatory = $true)]
    [ValidateSet('code-fix', 'review', 'investigate', 'ops-check', 'communicate', 'personal')]
    [string]$Kind
)

$ErrorActionPreference = 'Stop'

$inboxPath = 'C:\Obsidian\Task_Inbox_Vault\Task Inbox.md'
$requestDirectory = Join-Path $PSScriptRoot 'requests'
$mutexName = 'Local\TaskCapture_ObsidianInbox'

$headings = @{
    'now'       = '## 🔥 Do Now'
    'later'     = '## 📅 Do Later'
    'way-later' = '## 🌱 Do Way Later'
}

function Get-Utf8Text {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [ref]$HasBom
    )

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $HasBom.Value = $bytes.Length -ge 3 -and
        $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    $offset = if ($HasBom.Value) { 3 } else { 0 }
    $encoding = New-Object System.Text.UTF8Encoding($false, $true)
    return $encoding.GetString($bytes, $offset, $bytes.Length - $offset)
}

function Write-Utf8TextAtomically {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TemporaryPath,

        [Parameter(Mandatory = $true)]
        [string]$DestinationPath,

        [Parameter(Mandatory = $true)]
        [string]$Content,

        [Parameter(Mandatory = $true)]
        [bool]$IncludeBom
    )

    $encoding = New-Object System.Text.UTF8Encoding($false)
    $contentBytes = $encoding.GetBytes($Content)
    if ($IncludeBom) {
        $preamble = [System.Text.Encoding]::UTF8.GetPreamble()
        $outputBytes = New-Object byte[] ($preamble.Length + $contentBytes.Length)
        [System.Buffer]::BlockCopy($preamble, 0, $outputBytes, 0, $preamble.Length)
        [System.Buffer]::BlockCopy($contentBytes, 0, $outputBytes, $preamble.Length, $contentBytes.Length)
    }
    else {
        $outputBytes = $contentBytes
    }

    $backupPath = $TemporaryPath + '.bak'
    try {
        [System.IO.File]::WriteAllBytes($TemporaryPath, $outputBytes)
        [System.IO.File]::Replace($TemporaryPath, $DestinationPath, $backupPath)
    }
    finally {
        if (Test-Path -LiteralPath $backupPath) {
            Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
        }
    }
}

$mutex = $null
$hasMutex = $false
$temporaryPath = $null

try {
    if (-not (Test-Path -LiteralPath $requestDirectory -PathType Container)) {
        throw 'Request directory is missing.'
    }

    $resolvedRequestPath = (Resolve-Path -LiteralPath $RequestFile).ProviderPath
    $resolvedRequestDirectory = (Resolve-Path -LiteralPath $requestDirectory).ProviderPath
    if ((Split-Path -Parent $resolvedRequestPath) -ine $resolvedRequestDirectory -or
        (Get-Item -LiteralPath $resolvedRequestPath).PSIsContainer) {
        throw 'Request file is invalid.'
    }

    $requestHasBom = $false
    $description = Get-Utf8Text -Path $resolvedRequestPath -HasBom ([ref]$requestHasBom)
    $description = ($description -replace '[\r\n]+', ' ').Trim()
    if ([string]::IsNullOrWhiteSpace($description)) {
        throw 'Task text is blank.'
    }

    if (-not (Test-Path -LiteralPath $inboxPath -PathType Leaf)) {
        throw 'Task Inbox.md is missing.'
    }

    $mutex = New-Object System.Threading.Mutex($false, $mutexName)
    try {
        $hasMutex = $mutex.WaitOne([TimeSpan]::FromSeconds(5))
    }
    catch [System.Threading.AbandonedMutexException] {
        $hasMutex = $true
    }

    if (-not $hasMutex) {
        throw 'Task inbox is busy. Try again.'
    }

    $inboxHasBom = $false
    $content = Get-Utf8Text -Path $inboxPath -HasBom ([ref]$inboxHasBom)
    $newline = if ($content.Contains("`r`n")) { "`r`n" } elseif ($content.Contains("`n")) { "`n" } elseif ($content.Contains("`r")) { "`r" } else { $null }
    if ($null -eq $newline) {
        throw 'Task Inbox.md has no line endings.'
    }

    $heading = $headings[$Urgency]
    $headingMatch = [regex]::Match($content, '(?m)^' + [regex]::Escape($heading) + '(?=\r?$)')
    if (-not $headingMatch.Success) {
        throw "Task Inbox.md is missing heading: $heading"
    }

    $insertAt = $headingMatch.Index + $headingMatch.Length
    if ($content.Substring($insertAt).StartsWith("`r`n")) {
        $insertAt += 2
    }
    elseif ($content.Substring($insertAt).StartsWith("`n") -or $content.Substring($insertAt).StartsWith("`r")) {
        $insertAt += 1
    }
    else {
        $content = $content.Insert($insertAt, $newline)
        $insertAt += $newline.Length
    }

    $taskLine = '- [ ] ' + $description + ' #task/' + $Kind
    $updatedContent = $content.Substring(0, $insertAt) + $taskLine + $newline + $content.Substring($insertAt)
    $temporaryPath = Join-Path (Split-Path -Parent $inboxPath) ('.Task Inbox.md.' + [Guid]::NewGuid().ToString('N') + '.tmp')
    Write-Utf8TextAtomically -TemporaryPath $temporaryPath -DestinationPath $inboxPath -Content $updatedContent -IncludeBom $inboxHasBom
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
finally {
    if ($null -ne $temporaryPath -and (Test-Path -LiteralPath $temporaryPath)) {
        Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
    if ($hasMutex) {
        $mutex.ReleaseMutex()
    }
    if ($null -ne $mutex) {
        $mutex.Dispose()
    }
}
