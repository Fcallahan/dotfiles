# Pi Skill and Editor Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the two reported Jira skill collision warnings and give PiGate a clearly framed input editor with path context.

**Architecture:** Stop adding `~/.claude/skills` to Pi because Pi already discovers `~/.agents/skills`; this removes duplicate discovery without deleting either harness's skill copies. Enable Pi Zentui's existing framed editor, use the active theme's accent border, and retain the status line's `$cwd` path immediately alongside the editor rather than maintaining a custom editor fork.

**Tech Stack:** Pi JSON configuration, pi-zentui, shell-based startup validation

---

## File map

- Modify: `~/.pi/settings.json` — remove the redundant Claude skill discovery source.
- Modify: `pi/agent/zentui.json` — enable and style the existing Zentui editor.
- Preserve: `~/.claude/skills/{jira-cli-workflow,pr-jira-code-review}/SKILL.md` — Claude-specific copies.
- Preserve: `~/.agents/skills/{jira-cli-workflow,pr-jira-code-review}/SKILL.md` — Pi's automatically discovered copies.

### Task 1: Remove redundant Pi skill discovery

**Files:**
- Modify: `~/.pi/settings.json`

- [ ] **Step 1: Capture the current collision evidence**

Run:

```bash
cd /home/franciscallahan
script -q -c 'timeout 4 pi --offline --no-tools' /tmp/pi-before.txt || true
rg 'jira-cli-workflow|pr-jira-code-review|Skill conflicts' /tmp/pi-before.txt
```

Expected: startup output contains both reported skill names under `Skill conflicts`.

- [ ] **Step 2: Remove the redundant configured source**

Replace `~/.pi/settings.json` contents:

```json
{}
```

This keeps Pi's automatic `~/.agents/skills` discovery and stops the additive `~/.claude/skills` scan. Do not delete or symlink either harness's skill directories.

- [ ] **Step 3: Validate JSON and skill readability**

Run:

```bash
jq empty /home/franciscallahan/.pi/settings.json
for skill in jira-cli-workflow pr-jira-code-review; do
  test -r "/home/franciscallahan/.agents/skills/$skill/SKILL.md"
  test -r "/home/franciscallahan/.claude/skills/$skill/SKILL.md"
done
```

Expected: exit code 0 with no output.

- [ ] **Step 4: Confirm the reported collisions are gone**

Run:

```bash
cd /home/franciscallahan
script -q -c 'timeout 4 pi --offline --no-tools' /tmp/pi-after-skills.txt || true
if rg 'jira-cli-workflow|pr-jira-code-review' /tmp/pi-after-skills.txt; then
  echo 'Reported collision remains' >&2
  exit 1
fi
```

Expected: exit code 0 and no matching collision output.

### Task 2: Enable the clear-frame PiGate editor

**Files:**
- Modify: `pi/agent/zentui.json`

- [ ] **Step 1: Record the current disabled state**

Run:

```bash
jq -e '.features.editor == false' /home/franciscallahan/dotfiles/pi/agent/zentui.json
```

Expected: prints `true`.

- [ ] **Step 2: Apply the minimal editor configuration**

Change only these existing values in `pi/agent/zentui.json`:

```json
{
  "features": {
    "editor": true,
    "statusLine": true,
    "copyFriendly": false
  },
  "colors": {
    "editorAccent": "accent",
    "editorPrompt": "accent",
    "editorBorder": "borderAccent"
  }
}
```

Keep the existing `footerFormat` beginning with `$cwd`, all color-source values, and all model/provider/thinking colors unchanged. Zentui supplies the frame and the `opencode` theme supplies its distinct editor/message background; the adjacent status line supplies the current path without a `MESSAGE` label.

- [ ] **Step 3: Validate the complete effective configuration**

Run:

```bash
jq -e '
  .features.editor == true and
  .features.statusLine == true and
  .features.copyFriendly == false and
  .colors.editorBorder == "borderAccent" and
  (.footerFormat | startswith("$cwd"))
' /home/franciscallahan/dotfiles/pi/agent/zentui.json
```

Expected: prints `true`.

- [ ] **Step 4: Check Pi startup with Zentui enabled**

Run:

```bash
cd /home/franciscallahan
script -q -c 'timeout 4 pi --offline --no-tools' /tmp/pi-after-editor.txt || true
! rg -i 'zentui.*(error|failed)|invalid.*zentui|Skill conflicts' /tmp/pi-after-editor.txt
```

Expected: exit code 0; no Zentui configuration error and no skill-conflict heading.

- [ ] **Step 5: Review only intended diffs**

Run:

```bash
jq . /home/franciscallahan/.pi/settings.json
jq . /home/franciscallahan/dotfiles/pi/agent/zentui.json
git -C /home/franciscallahan/dotfiles diff -- pi/agent/zentui.json
git -C /home/franciscallahan/dotfiles status --short
```

Expected: `zentui.json` shows only editor enablement and `editorBorder` changing to `borderAccent`; pre-existing unrelated working-tree changes remain untouched. `~/.pi/settings.json` is outside the dotfiles repository and therefore absent from Git status.

### Task 3: Manual visual confirmation

- [ ] **Step 1: Restart PiGate**

Exit the current Pi process and launch a fresh interactive session:

```bash
cd /home/franciscallahan
pi
```

Expected: the editor has top/bottom accent rules and a left accent rail, a distinct filled editor area, and no floating-space appearance. The status line starts with the current working path and there is no `MESSAGE` label.

- [ ] **Step 2: Preserve changes for user review**

Do not commit configuration changes unless explicitly requested. Report the exact files changed and the validation output.
