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

4. Authenticate the `openai-codex` provider inside Pi with `/login`. Never copy or commit `auth.json` or other session/auth state.

5. The `gpt-5.6-sol` model comes from the tracked `pi/agent/models.json` symlinked to `~/.pi/agent/models.json`.

6. Run `/reload` inside Pi or restart Pi after installing/authenticating.

## What is installed

- `settings.json`, `keybindings.json`, `APPEND_SYSTEM.md`, and `models.json`
- OpenCode theme and Zentui config
- Curated extensions auto-discovered under `~/.pi/agent/extensions`:
  - `workflow`
  - `plan-build`
  - `command-palette`
  - `dynamic-workflow-ux`
  - `question`
  - `nvim-review`
- External files-widget repo cloned to `~/pi-extensions` and referenced as `~/pi-extensions/files-widget`

## Verification

Run:

```bash
test -L ~/.pi/agent/settings.json
test -L ~/.pi/agent/APPEND_SYSTEM.md
test -L ~/.pi/agent/models.json
test -L ~/.pi/agent/extensions/question
test -L ~/.pi/agent/extensions/dynamic-workflow-ux
test -L ~/.pi/agent/extensions/nvim-review
jq empty ~/.pi/agent/settings.json ~/.pi/agent/keybindings.json ~/.pi/agent/models.json
pi --version
```

Then start Pi and verify:

- OpenCode theme is active.
- The appended system prompt is loaded.
- `Ctrl+P` opens the command palette.
- The `question` tool is available.
- Workflow and dynamic workflow tools are available.
- Keybindings include `Ctrl+Shift+Alt+P` for session path toggle and `Ctrl+Shift+P` for provider toggle.
- Provider/model show `openai-codex` / `gpt-5.6-sol`.
