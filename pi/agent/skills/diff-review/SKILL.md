---
name: diff-review
description: Opens a git diff in Neovim with inline comment support via the pi_review module. Only invocable as /skill:diff-review.
disable-model-invocation: true
---

# Diff Review

Opens a git diff in Neovim with `pi_review` — the Neovim module at `lua/tuliopaim/pi_review.lua` that provides inline commenting, save/load from JSON, and comment navigation keymaps.

## Usage

In the Pi chat, ask:

- "review this branch"
- "review commit abc123"
- "review changes since main"
- "review my working tree"
- "open diff review for the current PR"
- `/skill:diff-review` or `/skill:diff-review <ref>`

The skill generates a diff, launches Neovim with Pi's review module, and saves comments back to a JSON file as you work.

## How it works

1. The script generates a diff (unified format) and writes it to a temp file
2. Creates an empty JSON comments file
3. Sets `PI_REVIEW_ROOT`, `PI_REVIEW_DIFF`, `PI_REVIEW_JSON` env vars
4. Opens Neovim — `tuliopaim/init.lua` detects the env vars and auto-starts `pi_review`
5. Keymaps in the review buffer: `<Space>rc` comment, `<Space>rd` delete, `<Space>rx` resolve, etc.

## Setup

Nothing needed — the Neovim module (`lua/tuliopaim/pi_review.lua`) is already installed.

## Scripts

### `scripts/start-review.sh`

```bash
./scripts/start-review.sh          # Diff working tree vs HEAD
./scripts/start-review.sh main     # Diff working tree vs main
./scripts/start-review.sh abc123   # Diff working tree vs commit abc123
./scripts/start-review.sh --commit abc123   # Show commit abc123 as the diff
./scripts/start-review.sh --pr 42           # Diff the PR branch changes
```

The script handles:
- **Working tree vs ref** (default: HEAD)
- **Single commit review** (`--commit`)
- **Saves** comments to `~/.local/state/nvim/reviews/<repo>/<scope>/review.json`
- Opens Neovim with the diff pre-loaded and `pi_review` auto-started

## After review

Comments are auto-saved on Neovim quit. The JSON file persists at:
`~/.local/state/nvim/reviews/<repo>/<scope>/review.json`

Re-run the skill with the same scope to resume where you left off.
