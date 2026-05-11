# Dictation Cleanup Design

## Summary

Build a Windows + WSL dictation cleanup tool for the existing dotfiles repo. The tool should let the user dictate into a small Windows popup using Windows Voice Typing, send the dictated text to a WSL cleanup script, clean it with the `pi` CLI using a fast DeepSeek model, then paste the cleaned result into the application that was focused before the popup opened.

This is intentionally not a port of the upstream macOS STT scripts. The macOS scripts own recording, transcription, status bar UI, clipboard, and paste automation through macOS-only APIs. On this workstation, Windows already provides good voice typing, so the useful missing layer is text cleanup and paste-back.

## Goals

- Provide a low-friction dictation workflow that avoids manual text selection.
- Use Windows Voice Typing for speech-to-text rather than recording audio in WSL.
- Use WSL and the existing terminal/AI setup for LLM cleanup.
- Default to a cheap, quick DeepSeek-backed `pi` model.
- Support two cleanup modes from one popup:
  - Light cleanup: preserve wording while fixing punctuation, capitalization, grammar, and obvious speech-to-text mistakes.
  - Polish: rewrite into natural professional US English while preserving intent and technical terms.
- Support an editable work vocabulary and replacement dictionary for project/product names and common STT misrecognitions.
- Keep implementation small, understandable, and easy to modify.

## Non-goals

- Do not implement microphone recording in WSL.
- Do not install or configure Whisper for this first version.
- Do not integrate with macOS status bar, `skhd`, `afrecord`, `pbcopy`, or `osascript`.
- Do not attempt to detect the last dictated text inside arbitrary Windows applications.
- Do not require storing API keys in Windows if `pi` is already configured in WSL.

## User Experience

1. User focuses the destination app and places the cursor where text should be inserted.
2. User presses a global Windows hotkey, initially `Ctrl+Alt+H`.
3. An AutoHotkey v2 popup opens and remembers the previously focused window.
4. Popup contains:
   - a multiline dictation text box,
   - a cleanup mode selector with `Light cleanup` and `Polish`,
   - a `Clean + Paste` button,
   - a status line for errors/progress.
5. User starts Windows Voice Typing inside the popup, normally with `Ctrl+H` on this machine.
6. User dictates into the popup.
7. User presses `Ctrl+Enter` or clicks `Clean + Paste`.
8. AutoHotkey sends the text and mode to the WSL cleanup script.
9. WSL cleanup script applies deterministic replacements, builds a cleanup prompt with vocabulary, and calls `pi`.
10. AutoHotkey receives cleaned text, copies it to the Windows clipboard, refocuses the original window, pastes with `Ctrl+V`, and closes the popup.

## Architecture

```text
Windows focused app
    ↑ paste cleaned text
AutoHotkey v2 popup + global hotkey
    ↓ text + cleanup mode
wsl.exe ~/dotfiles/dictation/cleanup-dictation --mode <mode>
    ↓ stdin/stdout
WSL bash script
    ↓ prompt
pi CLI with DeepSeek model
```

### Windows boundary

AutoHotkey owns the Windows-native responsibilities:

- global hotkey,
- lightweight popup UI,
- remembering the previous active window,
- invoking `wsl.exe`,
- writing input to the WSL process,
- reading cleaned stdout,
- pasting cleaned text into the previous app.

### WSL boundary

The WSL script owns text cleanup responsibilities:

- parsing mode,
- loading vocabulary files,
- applying simple deterministic replacements,
- constructing the LLM prompt,
- invoking `pi`,
- returning only final cleaned text on stdout,
- writing diagnostics to stderr.

## Files

### `dictation/cleanup-dictation`

Executable bash script run from WSL. Accepts text on stdin and writes cleaned text to stdout.

Supported arguments:

```bash
cleanup-dictation --mode light
cleanup-dictation --mode polish
cleanup-dictation --help
```

Environment variables:

```bash
DICTATION_CLEANUP_MODEL=opencode-go/deepseek-v4-flash
DICTATION_CLEANUP_THINKING=off
DICTATION_CLEANUP_PI_BIN=pi
DICTATION_CLEANUP_TIMEOUT_SECONDS=120
DICTATION_CLEANUP_REPLACEMENTS=$HOME/dotfiles/dictation/replacements.tsv
DICTATION_CLEANUP_VOCABULARY=$HOME/dotfiles/dictation/vocabulary.txt
DICTATION_CLEANUP_SKIP_LLM=0
```

`DICTATION_CLEANUP_SKIP_LLM=1` is useful for smoke tests. It returns deterministically replaced input without calling `pi`.

### `dictation/replacements.tsv`

Editable tab-separated replacement dictionary. Blank lines and lines beginning with `#` are ignored.

Format:

```tsv
spoken phrase	Replacement
```

Matching should be case-insensitive and phrase-boundary aware enough to avoid replacing inside larger words.

Initial entries:

```tsv
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

### `dictation/vocabulary.txt`

Editable list of work terms that should be preserved or corrected when likely intended.

Initial entries:

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

### `dictation/README.md`

User-facing setup and usage docs for the dictation workflow.

### `windows/dictation-cleanup.ahk`

AutoHotkey v2 script. It registers the global hotkey, opens the popup, calls WSL, and pastes the result.

Config constants near the top of the file should be easy to edit:

```ahk
HotkeyCombo := "^!h"
WslDistro := ""
WslScript := "~/dotfiles/dictation/cleanup-dictation"
DefaultMode := "light"
```

If `WslDistro` is empty, the script should use the default WSL distro:

```powershell
wsl.exe bash -lc '...'
```

If set, it should call:

```powershell
wsl.exe -d <distro> bash -lc '...'
```

### `README.md`

Add a short link from the main dotfiles README to `dictation/README.md`.

## Cleanup behavior

### Deterministic replacements

Before calling the LLM, the WSL script applies `replacements.tsv`. This directly fixes common voice typing errors such as `m status` becoming `EMStatus` even when the LLM is unavailable.

Replacement rules:

- ignore blank and comment lines,
- require exactly two fields separated by a tab,
- match case-insensitively,
- preserve the replacement exactly as written,
- apply rules in file order.

### LLM prompt

Both modes include:

- mode-specific instructions,
- vocabulary list,
- instruction to preserve code, commands, URLs, paths, issue IDs, product names, and proper nouns,
- instruction to return only final text with no markdown, labels, explanations, or quotes.

Light cleanup prompt intent:

> Preserve my wording and sentence structure as much as possible. Fix punctuation, capitalization, spelling, grammar, and obvious speech-to-text mistakes. Do not make the text more formal unless needed for correctness.

Polish prompt intent:

> Rewrite into clear, natural, professional US English. Improve flow, grammar, and clarity while preserving meaning, technical details, and work-specific terms.

## Error handling

### Empty input

If the user submits an empty popup, AutoHotkey should show a status message and leave the popup open.

### Missing AutoHotkey

Document installation, but dotfiles cannot install it from WSL automatically.

### Missing WSL script

AutoHotkey should show an error containing the command that failed.

### Missing `pi`

The WSL script should exit non-zero with a clear stderr message:

```text
cleanup-dictation: pi not found. Install/configure pi or set DICTATION_CLEANUP_PI_BIN.
```

### LLM failure

The WSL script should exit non-zero and include `pi` stderr. AutoHotkey should keep the popup open and show the error so the text is not lost.

### Clipboard safety

AutoHotkey may overwrite the clipboard with the cleaned text. It should save the previous clipboard before paste and restore it after a short delay if practical. If restore fails, the cleaned text remaining on the clipboard is acceptable because it is also useful to the user.

## Testing strategy

### WSL script tests

Use plain bash smoke tests rather than introducing a test framework.

Required checks:

- `--help` prints usage and exits successfully.
- Empty stdin exits non-zero.
- `DICTATION_CLEANUP_SKIP_LLM=1` applies replacements from a temporary TSV file.
- `--mode light` and `--mode polish` are accepted.
- Invalid mode exits non-zero.

### Manual Windows test

1. Install AutoHotkey v2.
2. Run `windows/dictation-cleanup.ahk` from Windows.
3. Open Notepad or another text box.
4. Press `Ctrl+Alt+H`.
5. Dictate or type `m status uses local stack and signal r`.
6. Choose `Light cleanup`.
7. Press `Ctrl+Enter`.
8. Confirm cleaned text is pasted into Notepad and includes `EMStatus`, `LocalStack`, and `SignalR`.

### LLM integration test

From WSL:

```bash
printf 'm status uses local stack and signal r' | ~/dotfiles/dictation/cleanup-dictation --mode light
```

Expected output should preserve meaning and correct work terms.

## Security and privacy

- Dictated text is sent to the configured `pi` model provider. The user should avoid dictating secrets unless they are comfortable sending them to that provider.
- No transcripts are intentionally persisted by the WSL script.
- The replacement and vocabulary files are tracked in dotfiles, so they should not contain secrets.

## Setup requirements

Windows:

- Windows Voice Typing available and enabled.
- AutoHotkey v2 installed.
- WSL installed and default distro can run `bash`.

WSL:

- Dotfiles repo exists at `~/dotfiles` or AutoHotkey `WslScript` is updated.
- `pi` CLI installed and authenticated/configured.
- Optional: `~/.local/bin` on PATH if the script is symlinked by `install.sh`.

## Future enhancements

- Add a Windows startup shortcut for the AutoHotkey script.
- Add multiple hotkeys for direct light/polish submission if desired later.
- Add a glossary format with descriptions, not just terms.
- Add a local fallback cleaner that only applies deterministic replacements when `pi` is offline.
- Add full audio recording + Whisper only if Windows Voice Typing becomes insufficient.
