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
deepseek/deepseek-v4-flash
```

Configure a DeepSeek API key outside this repo. Either export it from your private shell config:

```bash
export DEEPSEEK_API_KEY="sk-..."
```

Or store it in `~/.pi/agent/auth.json`:

```json
{
  "deepseek": {
    "type": "api_key",
    "key": "sk-..."
  }
}
```

Keep `~/.pi/agent/auth.json` private:

```bash
chmod 600 ~/.pi/agent/auth.json
```

Override the cleanup model in your shell if needed:

```bash
export DICTATION_CLEANUP_MODEL=deepseek/deepseek-v4-flash
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

### `No API key found for deepseek`

Set `DEEPSEEK_API_KEY` in your private shell config or add a `deepseek` entry to `~/.pi/agent/auth.json`.

### `402 Insufficient Balance`

The DeepSeek key is recognized, but the DeepSeek account does not have enough balance or credits. Add credits in the DeepSeek dashboard, then retry the same command.

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
