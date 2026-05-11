# Dictation Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows + WSL dictation cleanup popup that accepts Windows Voice Typing text, cleans it through WSL `pi` using DeepSeek, and pastes the result into the previously focused Windows app.

**Architecture:** AutoHotkey v2 owns the Windows global hotkey, popup UI, clipboard, focus, and paste automation. A WSL bash script owns deterministic replacements, prompt construction, `pi` invocation, and stdout/stderr behavior. Editable vocabulary and replacement files live beside the cleanup script in the dotfiles repo.

**Tech Stack:** AutoHotkey v2, WSL `bash`, `perl`, `timeout`, `pi`, DeepSeek model `opencode-go/deepseek-v4-flash`, plain bash smoke tests.

---

## File map

- Create: `dictation/cleanup-dictation`
  - WSL executable bash script. Reads dictated text from stdin, accepts `--mode light|polish`, applies replacements, calls `pi`, writes cleaned text to stdout.
- Create: `dictation/replacements.tsv`
  - Editable tab-separated spoken-phrase to preferred-term replacements.
- Create: `dictation/vocabulary.txt`
  - Editable newline-separated work vocabulary list included in the LLM prompt.
- Create: `dictation/README.md`
  - Setup, usage, troubleshooting, and privacy docs.
- Create: `windows/dictation-cleanup.ahk`
  - AutoHotkey v2 popup, global hotkey, WSL invocation, and paste automation.
- Create: `tests/dictation/run-cleanup-dictation-tests.sh`
  - Bash smoke tests for the WSL script.
- Modify: `README.md`
  - Add the dictation tool to the managed scripts/docs section.
- Modify: `install.sh`
  - No installer behavior change is required if `dictation/cleanup-dictation` stays outside `scripts/`. Add dependency warning for `pi` only if desired after core implementation. For the first implementation, leave `install.sh` unchanged to avoid surprising install behavior.

## Task 1: Add WSL cleanup script tests first

**Files:**
- Create: `tests/dictation/run-cleanup-dictation-tests.sh`

- [ ] **Step 1: Create the test directory**

Run:

```bash
cd /home/franciscallahan/dotfiles
mkdir -p tests/dictation
```

Expected: command exits with status 0.

- [ ] **Step 2: Write failing smoke tests**

Create `tests/dictation/run-cleanup-dictation-tests.sh` with this content:

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/dictation/cleanup-dictation"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local label="$3"
    if [[ "$haystack" == *"$needle"* ]]; then
        pass "$label"
    else
        printf 'Expected to find: %s\nIn output: %s\n' "$needle" "$haystack" >&2
        fail "$label"
    fi
}

assert_equals() {
    local actual="$1"
    local expected="$2"
    local label="$3"
    if [[ "$actual" == "$expected" ]]; then
        pass "$label"
    else
        printf 'Expected: %s\nActual:   %s\n' "$expected" "$actual" >&2
        fail "$label"
    fi
}

if [[ ! -x "$SCRIPT" ]]; then
    fail "cleanup script exists and is executable"
fi

help_output="$($SCRIPT --help)"
assert_contains "$help_output" "Usage: cleanup-dictation" "help prints usage"

if printf '' | DICTATION_CLEANUP_SKIP_LLM=1 "$SCRIPT" --mode light >"$TMP_DIR/empty.out" 2>"$TMP_DIR/empty.err"; then
    fail "empty stdin exits non-zero"
else
    assert_contains "$(cat "$TMP_DIR/empty.err")" "No input text provided" "empty stdin reports useful error"
fi

if printf 'hello' | DICTATION_CLEANUP_SKIP_LLM=1 "$SCRIPT" --mode formal >"$TMP_DIR/invalid.out" 2>"$TMP_DIR/invalid.err"; then
    fail "invalid mode exits non-zero"
else
    assert_contains "$(cat "$TMP_DIR/invalid.err")" "Invalid mode" "invalid mode reports useful error"
fi

cat >"$TMP_DIR/replacements.tsv" <<'TSV'
m status	EMStatus
local stack	LocalStack
signal r	SignalR
TSV

output="$(printf 'm status uses local stack and signal r' | \
    DICTATION_CLEANUP_SKIP_LLM=1 \
    DICTATION_CLEANUP_REPLACEMENTS="$TMP_DIR/replacements.tsv" \
    "$SCRIPT" --mode light)"
assert_equals "$output" "EMStatus uses LocalStack and SignalR" "skip-llm applies deterministic replacements"

polish_output="$(printf 'please polish m status' | \
    DICTATION_CLEANUP_SKIP_LLM=1 \
    DICTATION_CLEANUP_REPLACEMENTS="$TMP_DIR/replacements.tsv" \
    "$SCRIPT" --mode polish)"
assert_equals "$polish_output" "please polish EMStatus" "polish mode is accepted in skip-llm mode"

printf 'All cleanup-dictation smoke tests passed.\n'
```

- [ ] **Step 3: Make the test executable**

Run:

```bash
cd /home/franciscallahan/dotfiles
chmod +x tests/dictation/run-cleanup-dictation-tests.sh
```

Expected: command exits with status 0.

- [ ] **Step 4: Run tests and verify they fail because implementation is missing**

Run:

```bash
cd /home/franciscallahan/dotfiles
./tests/dictation/run-cleanup-dictation-tests.sh
```

Expected: FAIL with `cleanup script exists and is executable` because `dictation/cleanup-dictation` has not been created yet.

- [ ] **Step 5: Commit the failing tests**

Run:

```bash
cd /home/franciscallahan/dotfiles
git add tests/dictation/run-cleanup-dictation-tests.sh
git commit -m "test: add dictation cleanup smoke tests"
```

Expected: commit succeeds. If there are unrelated local changes, ensure only the test file is staged.

## Task 2: Implement the WSL cleanup script and editable dictionaries

**Files:**
- Create: `dictation/cleanup-dictation`
- Create: `dictation/replacements.tsv`
- Create: `dictation/vocabulary.txt`

- [ ] **Step 1: Create dictation directory**

Run:

```bash
cd /home/franciscallahan/dotfiles
mkdir -p dictation
```

Expected: command exits with status 0.

- [ ] **Step 2: Add default replacements**

Create `dictation/replacements.tsv` with this content:

```tsv
# spoken phrase	Replacement
m status	EMStatus
em status	EMStatus
em smart	EMSmart
billing rules	Billing Rules
local stack	LocalStack
tenant id	TenantId
signal r	SignalR
no op hub notification service	NoOpHubNotificationService
post track change rule	post-track-change-rule
ems mc	EMS|MC
```

- [ ] **Step 3: Add default vocabulary**

Create `dictation/vocabulary.txt` with this content:

```text
EMStatus
EMSmart
Billing Rules
LocalStack
TenantId
SignalR
EMS|MC
NoOpHubNotificationService
post-track-change-rule
```

- [ ] **Step 4: Implement `dictation/cleanup-dictation`**

Create `dictation/cleanup-dictation` with this content:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="light"

usage() {
    cat <<'EOF'
Usage: cleanup-dictation [--mode light|polish] [--help]

Read dictated text from stdin, apply work-specific replacements, clean it with
pi/DeepSeek, and print the final text to stdout.

Modes:
  light   Preserve wording; fix punctuation, capitalization, grammar, and STT mistakes.
  polish  Rewrite into clear, natural, professional US English.

Environment:
  DICTATION_CLEANUP_MODEL             Default: opencode-go/deepseek-v4-flash
  DICTATION_CLEANUP_THINKING          Default: off
  DICTATION_CLEANUP_PI_BIN            Default: pi
  DICTATION_CLEANUP_TIMEOUT_SECONDS   Default: 120
  DICTATION_CLEANUP_REPLACEMENTS      Default: <repo>/dictation/replacements.tsv
  DICTATION_CLEANUP_VOCABULARY        Default: <repo>/dictation/vocabulary.txt
  DICTATION_CLEANUP_SKIP_LLM          Set to 1/true/yes for deterministic replacement only.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --mode)
            if [[ $# -lt 2 ]]; then
                printf 'cleanup-dictation: --mode requires light or polish\n' >&2
                exit 2
            fi
            MODE="$2"
            shift 2
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            printf 'cleanup-dictation: unknown argument: %s\n' "$1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

case "$MODE" in
    light|polish) ;;
    *)
        printf 'cleanup-dictation: Invalid mode: %s. Expected light or polish.\n' "$MODE" >&2
        exit 2
        ;;
esac

INPUT="$(cat)"
INPUT="$(printf '%s' "$INPUT" | sed -e 's/[[:space:]]\+$//')"
if [[ -z "${INPUT//[[:space:]]/}" ]]; then
    printf 'cleanup-dictation: No input text provided.\n' >&2
    exit 1
fi

REPLACEMENTS_FILE="${DICTATION_CLEANUP_REPLACEMENTS:-$SCRIPT_DIR/replacements.tsv}"
VOCABULARY_FILE="${DICTATION_CLEANUP_VOCABULARY:-$SCRIPT_DIR/vocabulary.txt}"
PI_BIN="${DICTATION_CLEANUP_PI_BIN:-pi}"
MODEL="${DICTATION_CLEANUP_MODEL:-opencode-go/deepseek-v4-flash}"
THINKING="${DICTATION_CLEANUP_THINKING:-off}"
TIMEOUT_SECONDS="${DICTATION_CLEANUP_TIMEOUT_SECONDS:-120}"

apply_replacements() {
    local text="$1"
    local file="$2"

    if [[ ! -f "$file" ]]; then
        printf '%s' "$text"
        return 0
    fi

    perl -CSDA -Mutf8 -0pi -e '
        BEGIN {
            our @rules;
            my $file = $ENV{"DICTATION_REPLACEMENTS_FILE"};
            if (defined $file && -f $file) {
                open my $fh, "<:encoding(UTF-8)", $file or die "Cannot open replacements: $file\n";
                while (my $line = <$fh>) {
                    chomp $line;
                    $line =~ s/\r\z//;
                    next if $line =~ /^\s*$/;
                    next if $line =~ /^\s*#/;
                    my ($from, $to) = split /\t/, $line, 2;
                    next unless defined $from && defined $to && length $from;
                    push @rules, [$from, $to];
                }
            }
        }
        for my $rule (@rules) {
            my ($from, $to) = @$rule;
            s/(?<![\p{L}\p{N}_])\Q$from\E(?![\p{L}\p{N}_])/$to/gi;
        }
    ' <<<"$text"
}

load_vocabulary() {
    local file="$1"
    if [[ ! -f "$file" ]]; then
        printf '(none configured)'
        return 0
    fi

    grep -vE '^\s*($|#)' "$file" | sed 's/^/- /'
}

build_prompt() {
    local mode="$1"
    local text="$2"
    local vocabulary="$3"

    if [[ "$mode" == "light" ]]; then
        cat <<EOF
You are cleaning a speech-to-text transcript.

Mode: Light cleanup.
Preserve my wording and sentence structure as much as possible. Fix punctuation, capitalization, spelling, grammar, and obvious speech-to-text mistakes. Do not make the text more formal unless needed for correctness.

Preserve code, commands, URLs, file paths, issue IDs, product names, and proper names exactly when possible.
Correct work-specific terms when likely intended. Important vocabulary:
$vocabulary

Return only the final cleaned text. Do not include markdown, labels, explanations, or quotes.

Transcript:
$text
EOF
    else
        cat <<EOF
You are cleaning a speech-to-text transcript.

Mode: Polish.
Rewrite into clear, natural, professional US English. Improve flow, grammar, punctuation, and clarity while preserving the original meaning, technical details, and intent.

Preserve code, commands, URLs, file paths, issue IDs, product names, and proper names exactly when possible.
Correct work-specific terms when likely intended. Important vocabulary:
$vocabulary

Return only the final cleaned text. Do not include markdown, labels, explanations, or quotes.

Transcript:
$text
EOF
    fi
}

REPLACED="$(DICTATION_REPLACEMENTS_FILE="$REPLACEMENTS_FILE" apply_replacements "$INPUT" "$REPLACEMENTS_FILE")"

if [[ "${DICTATION_CLEANUP_SKIP_LLM:-0}" =~ ^(1|true|yes)$ ]]; then
    printf '%s\n' "$REPLACED"
    exit 0
fi

if ! command -v "$PI_BIN" >/dev/null 2>&1; then
    printf 'cleanup-dictation: pi not found. Install/configure pi or set DICTATION_CLEANUP_PI_BIN.\n' >&2
    exit 127
fi

VOCABULARY="$(load_vocabulary "$VOCABULARY_FILE")"
PROMPT="$(build_prompt "$MODE" "$REPLACED" "$VOCABULARY")"

if ! OUTPUT="$(timeout "$TIMEOUT_SECONDS" "$PI_BIN" \
    --model "$MODEL" \
    --thinking "$THINKING" \
    --no-tools \
    --no-session \
    --print <<<"$PROMPT")"; then
    status=$?
    printf 'cleanup-dictation: pi cleanup failed with status %s.\n' "$status" >&2
    exit "$status"
fi

OUTPUT="$(printf '%s' "$OUTPUT" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
if [[ -z "$OUTPUT" ]]; then
    printf 'cleanup-dictation: pi returned empty output.\n' >&2
    exit 1
fi

printf '%s\n' "$OUTPUT"
```

- [ ] **Step 5: Make the cleanup script executable**

Run:

```bash
cd /home/franciscallahan/dotfiles
chmod +x dictation/cleanup-dictation
```

Expected: command exits with status 0.

- [ ] **Step 6: Run smoke tests and verify they pass**

Run:

```bash
cd /home/franciscallahan/dotfiles
./tests/dictation/run-cleanup-dictation-tests.sh
```

Expected output includes:

```text
PASS: help prints usage
PASS: empty stdin reports useful error
PASS: invalid mode reports useful error
PASS: skip-llm applies deterministic replacements
PASS: polish mode is accepted in skip-llm mode
All cleanup-dictation smoke tests passed.
```

- [ ] **Step 7: Run local deterministic command manually**

Run:

```bash
cd /home/franciscallahan/dotfiles
printf 'm status uses local stack and signal r' | DICTATION_CLEANUP_SKIP_LLM=1 ./dictation/cleanup-dictation --mode light
```

Expected:

```text
EMStatus uses LocalStack and SignalR
```

- [ ] **Step 8: Commit WSL cleanup implementation**

Run:

```bash
cd /home/franciscallahan/dotfiles
git add dictation/cleanup-dictation dictation/replacements.tsv dictation/vocabulary.txt tests/dictation/run-cleanup-dictation-tests.sh
git commit -m "feat: add WSL dictation cleanup script"
```

Expected: commit succeeds.

## Task 3: Add AutoHotkey v2 popup

**Files:**
- Create: `windows/dictation-cleanup.ahk`

- [ ] **Step 1: Create Windows directory**

Run:

```bash
cd /home/franciscallahan/dotfiles
mkdir -p windows
```

Expected: command exits with status 0.

- [ ] **Step 2: Add AutoHotkey v2 script**

Create `windows/dictation-cleanup.ahk` with this content:

```ahk
#Requires AutoHotkey v2.0
#SingleInstance Force

; User-editable settings
HotkeyCombo := "^!h" ; Ctrl+Alt+H
WslDistro := ""      ; Empty means default WSL distro
WslScript := "~/dotfiles/dictation/cleanup-dictation"
DefaultMode := "light"
PopupWidth := 720
PopupHeight := 420

Hotkey HotkeyCombo, ShowDictationPopup

ShowDictationPopup(*) {
    global WslDistro, WslScript, DefaultMode, PopupWidth, PopupHeight

    previousWindow := WinExist("A")
    oldClipboard := ClipboardAll()

    dictGui := Gui("+AlwaysOnTop +Resize", "Dictation Cleanup")
    dictGui.SetFont("s10", "Segoe UI")
    dictGui.MarginX := 12
    dictGui.MarginY := 12

    dictGui.AddText("xm ym", "Dictate or type text below. Use Windows Voice Typing inside this box, then press Ctrl+Enter.")
    modeChoice := dictGui.AddDropDownList("xm y+8 w180", ["Light cleanup", "Polish"])
    modeChoice.Choose(DefaultMode = "polish" ? 2 : 1)

    edit := dictGui.AddEdit("xm y+8 w" . (PopupWidth - 24) . " h" . (PopupHeight - 145) . " WantTab -Wrap")
    status := dictGui.AddText("xm y+8 w" . (PopupWidth - 150), "Ready")
    cleanButton := dictGui.AddButton("x+8 yp-4 w110 Default", "Clean + Paste")

    cleanButton.OnEvent("Click", (*) => SubmitDictation(dictGui, edit, modeChoice, status, previousWindow, oldClipboard, WslDistro, WslScript))
    dictGui.OnEvent("Escape", (*) => dictGui.Destroy())
    dictGui.OnEvent("Close", (*) => dictGui.Destroy())
    dictGui.OnEvent("Size", (*) => ResizePopup(dictGui, edit, status, cleanButton))

    HotIfWinActive "Dictation Cleanup"
    Hotkey "^Enter", (*) => SubmitDictation(dictGui, edit, modeChoice, status, previousWindow, oldClipboard, WslDistro, WslScript), "On"
    HotIfWinActive

    dictGui.Show("w" . PopupWidth . " h" . PopupHeight)
    edit.Focus()
}

ResizePopup(dictGui, edit, status, cleanButton) {
    try {
        dictGui.GetClientPos(,, &width, &height)
        edit.Move(,, width - 24, height - 145)
        status.Move(, height - 40, width - 150)
        cleanButton.Move(width - 122, height - 44)
    }
}

SubmitDictation(dictGui, edit, modeChoice, status, previousWindow, oldClipboard, WslDistro, WslScript) {
    text := edit.Value
    if Trim(text) = "" {
        status.Text := "Enter or dictate text before submitting."
        return
    }

    selectedMode := modeChoice.Text = "Polish" ? "polish" : "light"
    status.Text := "Cleaning with WSL/pi..."

    try {
        cleaned := RunWslCleanup(text, selectedMode, WslDistro, WslScript)
    } catch as err {
        status.Text := "Error: " . err.Message
        return
    }

    if Trim(cleaned) = "" {
        status.Text := "Cleanup returned empty text. Popup left open."
        return
    }

    A_Clipboard := cleaned
    if !ClipWait(2) {
        status.Text := "Failed to place cleaned text on clipboard."
        return
    }

    if previousWindow {
        WinActivate "ahk_id " . previousWindow
        WinWaitActive "ahk_id " . previousWindow,, 2
        Sleep 100
        Send "^v"
        Sleep 250
        try A_Clipboard := oldClipboard
    }

    dictGui.Destroy()
}

RunWslCleanup(text, mode, WslDistro, WslScript) {
    tempIn := A_Temp . "\\dictation-cleanup-in-" . A_TickCount . ".txt"
    tempOut := A_Temp . "\\dictation-cleanup-out-" . A_TickCount . ".txt"
    tempErr := A_Temp . "\\dictation-cleanup-err-" . A_TickCount . ".txt"

    FileAppend text, tempIn, "UTF-8"

    distroPart := WslDistro = "" ? "" : "-d " . QuoteForCmd(WslDistro) . " "
    bashCommand := QuoteForBash(WslScript) . " --mode " . QuoteForBash(mode) . " < " . QuoteForBash(WindowsPathToWsl(tempIn))
    command := A_ComSpec . " /C wsl.exe " . distroPart . "bash -lc " . QuoteForCmd(bashCommand) . " > " . QuoteForCmd(tempOut) . " 2> " . QuoteForCmd(tempErr)

    exitCode := RunWait(command,, "Hide")
    output := FileExist(tempOut) ? FileRead(tempOut, "UTF-8") : ""
    errorOutput := FileExist(tempErr) ? FileRead(tempErr, "UTF-8") : ""

    TryDelete(tempIn)
    TryDelete(tempOut)
    TryDelete(tempErr)

    if exitCode != 0 {
        message := Trim(errorOutput) != "" ? Trim(errorOutput) : "wsl.exe exited with code " . exitCode
        throw Error(message)
    }

    return Trim(output, " `t`r`n")
}

WindowsPathToWsl(path) {
    drive := SubStr(path, 1, 1)
    rest := SubStr(path, 3)
    rest := StrReplace(rest, "\\", "/")
    return "/mnt/" . StrLower(drive) . rest
}

QuoteForCmd(value) {
    return '"' . StrReplace(value, '"', '\"') . '"'
}

QuoteForBash(value) {
    return "'" . StrReplace(value, "'", "'\''") . "'"
}

TryDelete(path) {
    try {
        if FileExist(path) {
            FileDelete path
        }
    }
}
```

- [ ] **Step 3: Syntax review the AutoHotkey script manually**

Run from WSL:

```bash
cd /home/franciscallahan/dotfiles
grep -n -e 'TO''DO' -e 'TB''D' windows/dictation-cleanup.ahk || true
```

Expected: no output.

- [ ] **Step 4: Commit AutoHotkey popup**

Run:

```bash
cd /home/franciscallahan/dotfiles
git add windows/dictation-cleanup.ahk
git commit -m "feat: add Windows dictation cleanup popup"
```

Expected: commit succeeds.

## Task 4: Add setup and usage documentation

**Files:**
- Create: `dictation/README.md`
- Modify: `README.md`

- [ ] **Step 1: Write dictation README**

Create `dictation/README.md` with this content:

```markdown
# Dictation Cleanup

Windows + WSL dictation cleanup workflow for these dotfiles.

## What it does

This tool lets you dictate into a small Windows popup, clean the dictated text with an LLM from WSL, and paste the cleaned result into the app where your cursor was.

It is designed for Windows Voice Typing + WSL. It does not record audio in WSL and does not use Whisper.

## Usage

1. Focus the app where you want text inserted.
2. Press `Ctrl+Alt+H` to open the dictation popup.
3. Click inside the text box if needed.
4. Start Windows Voice Typing with your normal shortcut, currently `Ctrl+H` on this machine.
5. Dictate your text.
6. Choose a cleanup mode:
   - `Light cleanup`: preserve wording; fix punctuation, capitalization, grammar, and obvious speech-to-text errors.
   - `Polish`: rewrite into clear, natural, professional US English.
7. Press `Ctrl+Enter` or click `Clean + Paste`.
8. The cleaned text is pasted into the app that was focused before the popup opened.

## Windows setup

Install AutoHotkey v2:

- https://www.autohotkey.com/

Run this script from Windows:

```text
windows/dictation-cleanup.ahk
```

To launch at startup, create a shortcut to `windows/dictation-cleanup.ahk` in the Windows Startup folder:

```text
shell:startup
```

## WSL setup

The AutoHotkey script expects this repo at:

```bash
~/dotfiles
```

The cleanup script is:

```bash
~/dotfiles/dictation/cleanup-dictation
```

Make sure it is executable:

```bash
chmod +x ~/dotfiles/dictation/cleanup-dictation
```

Make sure `pi` is installed and authenticated in WSL:

```bash
command -v pi
pi --help
```

Default model:

```bash
opencode-go/deepseek-v4-flash
```

Override it in your shell if needed:

```bash
export DICTATION_CLEANUP_MODEL=opencode-go/deepseek-v4-flash
export DICTATION_CLEANUP_THINKING=off
```

## Work vocabulary

Edit `dictation/vocabulary.txt` to add terms the LLM should preserve or correct when likely intended.

Example:

```text
EMStatus
EMSmart
Billing Rules
LocalStack
TenantId
SignalR
```

Do not add secrets. This file is tracked in git.

## Deterministic replacements

Edit `dictation/replacements.tsv` to fix common speech-to-text mistakes before the LLM runs.

Format:

```tsv
spoken phrase	Replacement
```

Example:

```tsv
m status	EMStatus
local stack	LocalStack
signal r	SignalR
```

The replacement file is tab-separated. Use a real tab between columns.

## WSL-only testing

Run the smoke tests:

```bash
cd ~/dotfiles
./tests/dictation/run-cleanup-dictation-tests.sh
```

Run deterministic replacement mode without calling the LLM:

```bash
printf 'm status uses local stack and signal r' | \
  DICTATION_CLEANUP_SKIP_LLM=1 \
  ~/dotfiles/dictation/cleanup-dictation --mode light
```

Expected:

```text
EMStatus uses LocalStack and SignalR
```

Run real LLM cleanup:

```bash
printf 'm status uses local stack and signal r' | \
  ~/dotfiles/dictation/cleanup-dictation --mode light
```

## Troubleshooting

### Popup says WSL failed

Run this in PowerShell:

```powershell
wsl.exe bash -lc 'printf "m status" | ~/dotfiles/dictation/cleanup-dictation --mode light'
```

If that fails, fix the WSL-side error first.

### `pi not found`

Install or configure `pi` in WSL, or set:

```bash
export DICTATION_CLEANUP_PI_BIN=/path/to/pi
```

### Wrong WSL distro

Edit `windows/dictation-cleanup.ahk` and set:

```ahk
WslDistro := "YourDistroName"
```

List distro names in PowerShell:

```powershell
wsl.exe -l -v
```

### Text is not pasted into the expected app

The script remembers the active window before the popup opens. If another window steals focus, paste can land elsewhere. Try again with the target app focused before pressing `Ctrl+Alt+H`.

## Privacy

Dictated text is sent to the configured `pi` model provider. Do not dictate secrets unless you are comfortable sending them to that provider.

The script does not intentionally save dictated transcripts.
```

- [ ] **Step 2: Update main README managed section**

In `README.md`, add this section after the existing `### Scripts (~/.local/bin)` list:

```markdown
### Dictation cleanup
- `dictation/cleanup-dictation` — WSL cleanup script for Windows Voice Typing text.
- `dictation/replacements.tsv` — editable speech-to-text replacement dictionary.
- `dictation/vocabulary.txt` — editable work vocabulary for LLM cleanup prompts.
- `windows/dictation-cleanup.ahk` — AutoHotkey v2 popup and paste workflow.

See `dictation/README.md` for setup and usage.
```

- [ ] **Step 3: Verify docs have no placeholders**

Run:

```bash
cd /home/franciscallahan/dotfiles
placeholder_pattern='TB''D|TO''DO|implement'' later|fill'' in'' details'
grep -RInE "$placeholder_pattern" dictation/README.md README.md || true
```

Expected: no output.

- [ ] **Step 4: Commit docs**

Run:

```bash
cd /home/franciscallahan/dotfiles
git add dictation/README.md README.md
git commit -m "docs: document dictation cleanup workflow"
```

Expected: commit succeeds.

## Task 5: Verify end-to-end WSL behavior and prepare Windows manual test

**Files:**
- Modify only if verification reveals a defect.

- [ ] **Step 1: Run smoke tests**

Run:

```bash
cd /home/franciscallahan/dotfiles
./tests/dictation/run-cleanup-dictation-tests.sh
```

Expected: all tests pass.

- [ ] **Step 2: Verify `pi` is available**

Run:

```bash
command -v pi && pi --help >/tmp/dictation-pi-help.txt && head -5 /tmp/dictation-pi-help.txt
```

Expected: `command -v pi` prints a path. If `pi` is unavailable, document that Windows popup testing can proceed only through `DICTATION_CLEANUP_SKIP_LLM=1` or after `pi` setup.

- [ ] **Step 3: Run real LLM cleanup if `pi` is available**

Run:

```bash
cd /home/franciscallahan/dotfiles
printf 'm status uses local stack and signal r' | ./dictation/cleanup-dictation --mode light
```

Expected: output is a cleaned sentence that includes `EMStatus`, `LocalStack`, and `SignalR`.

- [ ] **Step 4: Run Windows command bridge manually from PowerShell**

From Windows PowerShell, run:

```powershell
wsl.exe bash -lc 'printf "m status uses local stack and signal r" | ~/dotfiles/dictation/cleanup-dictation --mode light'
```

Expected: output is a cleaned sentence that includes `EMStatus`, `LocalStack`, and `SignalR`.

- [ ] **Step 5: Run AutoHotkey manual test**

From Windows:

1. Install AutoHotkey v2 if not installed.
2. Double-click `windows/dictation-cleanup.ahk`.
3. Open Notepad.
4. Press `Ctrl+Alt+H`.
5. Type or dictate `m status uses local stack and signal r` into the popup.
6. Select `Light cleanup`.
7. Press `Ctrl+Enter`.

Expected: Notepad receives cleaned text with `EMStatus`, `LocalStack`, and `SignalR`.

- [ ] **Step 6: Commit fixes if any were needed**

If verification required changes, run:

```bash
cd /home/franciscallahan/dotfiles
git add dictation windows tests README.md
git commit -m "fix: stabilize dictation cleanup workflow"
```

Expected: commit succeeds only if files changed. If no files changed, skip this commit.

## Self-review

### Spec coverage

- Popup UI and global hotkey: Task 3.
- WSL cleanup script: Task 2.
- Two cleanup modes: Task 2 script and Task 3 selector.
- DeepSeek via `pi`: Task 2 script and Task 5 verification.
- Editable vocabulary/replacements: Task 2 and Task 4 docs.
- Error handling: Task 2 script and Task 3 popup status.
- Tests: Task 1 and Task 5.
- Setup docs: Task 4.

### Placeholder scan

This plan intentionally contains no placeholder tokens or unspecified test steps. All code-bearing steps include complete code blocks.

### Type and interface consistency

- AutoHotkey calls `cleanup-dictation --mode light|polish`.
- Bash script accepts `--mode light|polish`.
- Tests use `DICTATION_CLEANUP_SKIP_LLM=1`, `DICTATION_CLEANUP_REPLACEMENTS`, and both supported modes.
