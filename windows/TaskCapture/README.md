# TaskCapture

AutoHotkey v2 hotkeys for quick Obsidian todos and timed reminders on Windows.

| Hotkey | Action |
|---|---|
| `Win+Shift+T` | Quick task popup; inserts `- [ ] <text> #task/<kind>` under Do Now / Do Later / Do Way Later |
| `Win+Shift+R` | Reminder in N minutes (one-time Windows Task Scheduler job + toast) |
| `Win+Shift+D` / `Win+Shift+I` | Open `Task Inbox.md` in Obsidian |
| `Ctrl+Shift+H` | Dictation cleanup popup (uses WSL `~/dotfiles/dictation/cleanup-dictation`) |

## Install on a new computer

1. Install AutoHotkey v2: `winget install --id AutoHotkey.AutoHotkey --scope user`
2. Create the Obsidian vault at `C:\Obsidian\Task_Inbox_Vault` with `Task Inbox.md` containing these headings:
   `## 🔥 Do Now`, `## 📅 Do Later`, `## 🌱 Do Way Later`.
   (The vault itself is not in dotfiles. Move it with Obsidian Sync, OneDrive, or a copy.)
3. From Windows PowerShell, run:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "\\wsl.localhost\Ubuntu-24.04\home\franciscallahan\dotfiles\windows\TaskCapture\Install-TaskCapture.ps1"
   ```

The installer copies the scripts to `%USERPROFILE%\scripts\TaskCapture` (a local copy starts faster than a `\\wsl.localhost` path), creates a `TaskCapture.lnk` Startup shortcut, and starts the hotkeys. Re-run it after changing the scripts here.

## Files

- `TaskCapture.ahk` — hotkeys and popups.
- `Add-ObsidianTask.ps1` — inserts the task into the inbox atomically. Keep this file UTF-8 **with BOM**; Windows PowerShell 5.1 needs it to read the emoji headings.
- `Schedule-Reminder.ps1` — registers the one-time scheduled task.
- `Show-Reminder.ahk` — shows the reminder, then deletes its scheduled task.

The vault path (`C:\Obsidian\Task_Inbox_Vault\Task Inbox.md`) is hard-coded in `Add-ObsidianTask.ps1` and the vault name in `TaskCapture.ahk`'s `OpenTaskInbox()`.
