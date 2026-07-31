# Pi setup from dotfiles

Use this when setting up Pi on a fresh machine or when another AI agent needs to reproduce the current Pi configuration.

## Agent prompt

Give an AI agent this exact prompt:

> Set up Pi from this dotfiles repo. Follow docs/pi-setup.md, run the installer, install missing Pi packages, authenticate without committing secrets, and verify the checklist.

## Install

1. From this repo, run:

   ```bash
   ./install.sh
   ```

2. Install and authenticate Pi separately if the `pi` command is missing. The installer only warns about missing Pi; it does not install or authenticate it.

3. Pi packages are declared in `pi/agent/settings.json`:
   - `npm:pi-subagents`
   - `npm:pi-zentui`
   - `npm:pi-tool-display`

   Pi should set these up from settings. They can also be installed manually:

   ```bash
   pi install npm:pi-subagents
   pi install npm:pi-zentui
   pi install npm:pi-tool-display
   ```

4. Authenticate the `openai-codex` provider inside Pi with `/login`. Authenticate OpenRouter only if DeepSeek access is wanted. Never copy or commit `auth.json` or other session/auth state.

5. Pi's built-in `openai-codex/gpt-5.6-sol` uses the Codex subscription. `models.json` only overrides built-in metadata; it does not define a custom model. The `openrouter-deepseek-only` extension removes non-DeepSeek OpenRouter models from Pi's effective catalog.

6. Run `/reload` inside Pi or restart Pi after installing/authenticating.

## What is installed

- `settings.json`, `keybindings.json`, `APPEND_SYSTEM.md`, and `models.json`
- OpenCode theme and Zentui config
- Curated extensions auto-discovered under `~/.pi/agent/extensions`:
  - `workflow`
  - `plan-build`
  - `command-palette`
  - `dynamic-workflow-ux`
  - `managed-background-jobs`
  - `question`
  - `nvim-review`
  - `openrouter-deepseek-only.ts`
- External files-widget repo cloned to `~/pi-extensions` and referenced as `~/pi-extensions/files-widget`

Managed background-job state lives under `~/.pi/agent/background-jobs/`. Each job keeps a state file and size-rotated output logs; terminal jobs older than 14 days are removed at session start. Use `/jobs` for a quick list or the `background_jobs` tool for status, logs, graceful stop, restart, and cleanup.

## Verification

Run:

```bash
test -L ~/.pi/agent/settings.json
test -L ~/.pi/agent/APPEND_SYSTEM.md
test -L ~/.pi/agent/models.json
test -L ~/.pi/agent/extensions/question
test -L ~/.pi/agent/extensions/dynamic-workflow-ux
test -L ~/.pi/agent/extensions/managed-background-jobs
test -L ~/.pi/agent/extensions/nvim-review
test -L ~/.pi/agent/extensions/openrouter-deepseek-only.ts
jq empty ~/.pi/agent/settings.json ~/.pi/agent/keybindings.json ~/.pi/agent/models.json
pi --version
```

Then start Pi and verify:

- OpenCode theme is active.
- The appended system prompt is loaded.
- `Ctrl+P` opens the command palette.
- The `question` tool is available.
- Workflow, dynamic workflow, `managed_bash`, and `background_jobs` tools are available.
- A long `managed_bash` call with `run_in_background=true` returns immediately and remains visible through `/jobs`.
- During a foreground `managed_bash` call, `Ctrl+B` backgrounds the job; when no managed foreground job is running, `Ctrl+B` still moves the editor cursor left.
- Keybindings include `Ctrl+Shift+Alt+P` for session path toggle and `Ctrl+Shift+P` for provider toggle.
- Provider/model show `openai-codex` / `gpt-5.6-sol`.
- OpenRouter models shown by Pi all have IDs beginning with `deepseek/`; no OpenRouter GPT model is selectable.
