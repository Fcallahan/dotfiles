# Dictation Cleanup Context

This document gives future AI agents enough context to safely maintain the dictation cleanup workflow.

## Purpose

The workflow lets the user dictate text on Windows, clean it with an LLM from WSL, and paste the result into the app that had focus before the popup opened.

The user prefers this flow:

1. Focus target app/text field.
2. Press `Ctrl+Alt+H` Windows shortcut.
3. A small PowerShell WinForms popup opens.
4. Dictate/type into the popup.
5. Press `Ctrl+Enter` or click `Clean + Paste`.
6. Text is cleaned through WSL + `pi` + OpenRouter.
7. Cleaned text is copied to clipboard and should paste back into the original app.

## Important files

- `windows/dictation-cleanup-hidden.vbs`
  - Hidden Windows launcher. Use this for shortcuts to avoid a visible PowerShell terminal.
- `windows/dictation-cleanup.ps1`
  - Main Windows popup. Handles UI, clipboard, WSL invocation, focus restore, and paste attempt.
- `dictation/cleanup-dictation`
  - WSL bash cleanup script. Applies replacements, builds the LLM prompt, invokes `pi`, prints cleaned text.
- `dictation/replacements.tsv`
  - Deterministic speech-to-text replacements. Safe and easy to edit.
- `dictation/vocabulary.txt`
  - Terms included in the LLM prompt as vocabulary to preserve.
- `tests/dictation/run-cleanup-dictation-tests.sh`
  - Smoke tests for the WSL cleanup script.

## Current shortcut target

Use this Windows shortcut target:

```text
wscript.exe "\\wsl.localhost\Ubuntu-24.04\home\franciscallahan\dotfiles\windows\dictation-cleanup-hidden.vbs"
```

Shortcut key:

```text
Ctrl + Alt + H
```

If debugging startup problems, bypass the hidden launcher and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "\\wsl.localhost\Ubuntu-24.04\home\franciscallahan\dotfiles\windows\dictation-cleanup.ps1"
```

## Provider and model

The cleanup script uses `pi` with OpenRouter.

Current defaults:

```bash
DICTATION_CLEANUP_PROVIDER=openrouter
DICTATION_CLEANUP_MODEL=qwen/qwen3.5-9b
DICTATION_CLEANUP_THINKING=off
```

The OpenRouter API key must be configured outside this repo, either as:

```bash
export OPENROUTER_API_KEY="sk-or-..."
```

or in `~/.pi/agent/auth.json`:

```json
{
  "openrouter": {
    "type": "api_key",
    "key": "sk-or-..."
  }
}
```

Do not commit API keys.

## Model comparison notes

Measured from WSL on 2026-05-11 using this test input in polish mode:

```text
m status uses local stack and signal r
```

Observed latencies:

| Model | Runs | Notes |
| --- | ---: | --- |
| `qwen/qwen3.5-9b` | ~1.3-1.4s | Current default. Fastest measured. Good enough for cleanup. |
| `qwen/qwen3.5-flash-02-23` | ~1.6-2.0s | Also fast; output was slightly closer to original wording in the sample. |
| `deepseek/deepseek-v4-flash` | ~3.4-8.0s | Slower and more variable in this workflow. |

OpenRouter pricing observed from `https://openrouter.ai/api/v1/models` on 2026-05-11:

| Model | Input price | Output price | Context |
| --- | ---: | ---: | ---: |
| `qwen/qwen3.5-9b` | $0.04 / 1M tokens | $0.15 / 1M tokens | 262k |
| `qwen/qwen3.5-flash-02-23` | $0.065 / 1M tokens | $0.26 / 1M tokens | 1M |
| `deepseek/deepseek-v4-flash` | $0.14 / 1M tokens | $0.28 / 1M tokens | 1M |

For short dictation cleanup, price differences are tiny per call, but Qwen 3.5 9B is both cheaper and faster in local tests.

## Current known issue

Paste-back has been inconsistent. The script reliably puts cleaned text on the clipboard, but paste into the original app may fail depending on Windows focus behavior.

Current paste logic in `windows/dictation-cleanup.ps1`:

1. Set clipboard to cleaned text.
2. Close popup.
3. Sleep 150ms.
4. Call `SetForegroundWindow(previousWindow)`.
5. Sleep 500ms.
6. Send `Ctrl+V` using `[System.Windows.Forms.SendKeys]::SendWait('^v')`.

If improving this, debug focus first. Do not blindly change paste methods. Useful options to investigate:

- Log or display whether `SetForegroundWindow` returns true.
- Capture foreground window handle before and after activation.
- Try a delayed second-stage paste via a separate `powershell.exe -WindowStyle Hidden -Command ...` after the popup exits.
- Try Windows Script Host `WScript.Shell.SendKeys("^v")` after activation.
- Try Win32 `keybd_event` only if focus evidence shows the right window is active.

## Replacement dictionary notes

`dictation/replacements.tsv` is tab-separated. Use real tabs.

Current examples include:

```tsv
m status	EMStatus
am status	EMStatus
julio	Tulio
eder	Eder
edder	Eder
edgar	Eder
```

The replacement pass is deterministic and happens before the LLM prompt.

## Test commands

Run WSL smoke tests:

```bash
cd ~/dotfiles
./tests/dictation/run-cleanup-dictation-tests.sh
```

Run deterministic replacement test without LLM:

```bash
printf 'julio talked to edder about AM status' | \
  DICTATION_CLEANUP_SKIP_LLM=1 \
  ./dictation/cleanup-dictation --mode polish
```

Run real LLM cleanup:

```bash
printf 'm status uses local stack and signal r' | \
  ./dictation/cleanup-dictation --mode polish
```

Parse-check PowerShell script from WSL:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile("\\wsl.localhost\Ubuntu-24.04\home\franciscallahan\dotfiles\windows\dictation-cleanup.ps1", [ref]$tokens, [ref]$errors) > $null; if($errors.Count){$errors | ForEach-Object { $_.Message }; exit 1}; "parse-ok"'
```
