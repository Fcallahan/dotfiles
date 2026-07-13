---
name: git-commit-worktree
description: >
  Git commit and merge-commit workflow that auto-extracts the ticket number
  from the git worktree name. Preserve the exact Jira key: AM-XXXXX,
  EMSVC-XXXXX, or EMV-XXXXX. Always asks you to verify the commit title and
  description before executing. Use this skill whenever the user says
  "commit", "merge commit", "create a commit", "commit this", or any
  git-commit-related request.
---

# Git Commit Worktree

This skill helps you create properly formatted git commits and merge commits
by automatically extracting the ticket number from the current git worktree
(or branch) and prepending it to the commit title. **It always asks you to
verify the title and description before executing.**

## Supported Projects

| Project | Ticket Format | Worktree Example |
|---------|---------------|------------------|
| EMSmart2.0 (E2) | `AM-XXXXX` | `AM-18994` |
| Billing Rules (BR) | `EMSVC-XXXXX` or `EMV-XXXXX` | `EMSVC-95-clean` → `EMSVC-95` |
| EMStatus / NEMSIS | `EMSVC-XXXXX` or `EMV-XXXXX` | `EMSVC-444` |

## Setup

The helper script is at:
`scripts/extract-ticket.sh`

Make sure it is executable:

```bash
chmod +x /home/franciscallahan/.pi/agent/skills/git-commit-worktree/scripts/extract-ticket.sh
```

## Workflow — Regular Commits

When the user asks you to "commit", "commit this", "save this", or "create a
commit":

### Step 1: Extract the ticket number

Run the helper script from the project directory:

```bash
./scripts/extract-ticket.sh /path/to/project
```

Or manually determine the ticket:

- **EMSmart2.0 repos** — look for `AM-` followed by digits in the git worktree
  directory name or current branch name. The worktree directory name often IS
  the ticket number (e.g., `AM-18994`).
- **BR / EMStatus / NEMSIS repos** — look for `EMSVC-` or `EMV-` followed by
  digits and preserve that exact Jira key. Never rewrite one project prefix to another.

### Step 2: Gather staged and unstaged changes

```bash
# Staged
git diff --staged --stat

# Unstaged tracked files
git diff --stat

# Untracked
git status --short
```

### Step 3: Draft the commit message

Format:
```
[TICKET] Summary of changes (imperative mood, ≤72 chars)

- Bullet-point list of what changed and why
- Reference any related tickets or context
```

For example:
```
[AM-18994] Add NoOpHubNotificationService for seed-mode signalR bypass

- Introduces NoOpHubNotificationService to satisfy DI during --seed-modern
- Added skipSignalR parameter to AddInfrastructureServices
- Detection in Program.cs for the seed flag
```

### Step 4: Present to user for verification

Show the user the full commit message you intend to use. **Ask them to confirm**
before running `git commit`.

> "Here's the commit I've prepared. Please verify the title and description:
> 
> ```
> [AM-18994] Add NoOpHubNotificationService for seed-mode signalR bypass
> ```
> 
> Proceed? (y/n)"

Wait for explicit approval. If they ask for changes, revise and re-present.

### Step 5: Execute

```bash
git commit -m "$TITLE" -m "$BODY"
```

---

## Workflow — Merge Commits (into Stage)

When the user says "merge into stage", "create a merge commit", or "merge PR
into stage":

### Step 1: Extract the ticket number (same as above)

### Step 2: Gather context about what's being merged

```bash
# See what branches/commits are involved
git log --oneline HEAD ^stage 2>/dev/null || git log --oneline -10
```

### Step 3: Draft the merge commit message

Format for merge commits:
```
Merge [TICKET] <source-branch> into stage

<summary of what this merge brings>
```

### Step 4: **Must present for user verification**

This is critical. Before running `git merge` or creating a merge commit:

1. Show the full merge commit title and description
2. Ask the user to verify BOTH the title and description
3. Wait for explicit approval

> "Here's the merge commit I've prepared for merging into stage:
>
> **Title:** `Merge [AM-18994] Add NoOpHubNotificationService into stage`
> **Description:**
> ```
> Merges the seed-mode Redis/SignalR bypass changes:
> - NoOpHubNotificationService for DI satisfaction
> - skipSignalR parameter on AddInfrastructureServices
> - --seed-modern detection in Program.cs
> ```
>
> Please verify the title and description. Proceed with merge? (y/n)"

### Step 5: Execute on approval

```bash
git merge --no-ff <source-branch> -m "$TITLE" -m "$BODY"
```

---

## Workflow — Creating PRs into Stage

When the user asks to "create a PR into stage", "open a PR", or "submit for
review":

### Step 1: Extract the ticket number (same as above)

### Step 2: Draft the PR title and description

Use the same ticket-prefix format:
- **Title:** `[TICKET] Summary`
- **Description:** Bullet points of changes + any testing notes

### Step 3: Present for verification

Show the full PR title and body. Ask for confirmation.

### Step 4: Create the PR

```bash
gh pr create --base stage --title "$TITLE" --body "$BODY"
```

---

## Notes

- Ticket extraction fails closed. If no supported Jira key is found, stop and
  ask for the correct ticket; never invent a placeholder.
- This skill works with git worktrees (primary use case), as well as direct
  branches in a regular clone.
- Always follow the verification step. Never commit or merge without showing
  the user the exact title and description first.