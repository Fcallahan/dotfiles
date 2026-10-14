---
name: git-commit-worktree
description: >
  Git branch, commit, push, merge-commit, and pull request workflow that
  auto-extracts the ticket number from the git worktree or branch name when the
  repository requires one. Preserve the exact Jira key: AM-XXXXX, EMSVC-XXXXX,
  or EMV-XXXXX. Titles use the team format `AM-12345: Title of the change`.
  M6 commits and PRs may omit a Jira key. Asks for title/body verification
  unless publication is already authorized by a scoped PR-feedback request.
  Use this skill whenever the user asks to
  create a branch or worktree, commit, push, merge commit, or open a PR.
---

# Git Commit Worktree

This skill creates properly named branches and properly formatted commits,
merge commits, and pull requests. It extracts the ticket number from the
current git worktree (or branch) and puts it at the start of every title.
**Ask for title and description verification when approval is still needed.
Do not add another approval loop to an already authorized PR-feedback cycle.**

## PR-Feedback Authorization

"Address PR feedback", "respond to the comments", and similar requests authorize
scoped fixes, validation, commits, pushes, replies, PR-description updates, and
CI/Gitar monitoring, including ordinary follow-up findings. Present the intended
commit message when useful, then proceed without asking again for each commit
or push. This exception applies across repositories.

Explicit review-only/local-only/no-push/draft-first limits take precedence.
Formatting, validation, review, ownership, and environment gates still apply.
Ask before merging, dismissing reviews, deploying, force-pushing, destructive
work, security/production-configuration changes, breaking public contracts,
or expanding into unrelated work. Creating a new PR still follows its own
approval steps.

## Team Standards

| Artifact | Format | Example |
|----------|--------|---------|
| Branch / worktree | `<TICKET>-<PascalCaseDescription>` | `AM-21260-FixResetProviderOverride`, `AM-21247-BRv2Fixes` |
| Commit title | `<TICKET>: Summary` | `AM-21222: Log location GPS coordinate changes` |
| PR title | `<TICKET>: Title of the change or story` | `AM-21218: Bump EmsmartCommon for shutdown during start-up` |
| PR description | 2–3 sentence scope summary + PR checklist of steps performed | see [Creating PRs](#workflow--creating-prs) |

Use the ticket key exactly as Jira shows it, followed by a colon and one
space. Do not use the older `[AM-12345] Summary` or `AM-12345 - Summary`
forms. In M6, drop the `<TICKET>: ` prefix when no key was supplied.

## Supported Projects

| Project | Ticket Format | Worktree Example |
|---------|---------------|------------------|
| EMSmart2.0 (E2) | `AM-XXXXX` | `AM-21260-FixResetProviderOverride` → `AM-21260` |
| Billing Rules (BR) | `EMSVC-XXXXX` or `EMV-XXXXX` | `EMSVC-95-AddLcdReorderRule` → `EMSVC-95` |
| EMStatus / NEMSIS (outside M6) | `EMSVC-XXXXX` or `EMV-XXXXX` | `EMSVC-444-FixStatusPolling` → `EMSVC-444` |
| M6 (`EMS-Management-Consultants/M6`) | No ticket required | `rydecentral-graceful-shutdown` |

## Determine Whether a Ticket Is Required

Every workflow below starts here.

First identify the canonical GitHub repository:

```bash
gh repo view --json nameWithOwner --jq .nameWithOwner
```

If the canonical repository is `EMS-Management-Consultants/M6`, a Jira key is
optional. Its Git remote may still use the legacy
`EMS-Management-Consultants/Nemsis.git` URL, so do not rely on the origin URL
alone. Do not block the commit or PR when the branch, PR, or worktree has no
key; omit the ticket prefix from the title. If the user explicitly supplied a
key, preserve it.

For every other supported repository, extract the ticket from the worktree
directory name first, then the current branch:

```bash
{ basename "$(git rev-parse --show-toplevel)"; git branch --show-current; } \
  | grep -oE '(AM|EMSVC|EMV)-[0-9]+' | head -1
```

- **EMSmart2.0 repos** — expect `AM-` followed by digits. The worktree
  directory name starts with the ticket number (e.g., `AM-21260-FixResetProviderOverride`;
  older worktrees may be just `AM-18994`).
- **BR / EMStatus / NEMSIS repos** — expect `EMSVC-` or `EMV-` followed by
  digits. Never rewrite one project prefix to another.

If no key is found outside M6, stop and ask for the correct ticket. Never
invent a placeholder.

---

## Workflow — Creating Branches

When the user asks to "create a branch", "start a worktree", or "start work on
AM-12345":

1. **Name the branch** `<TICKET>-<PascalCaseDescription>`, for example
   `AM-21260-FixResetProviderOverride`. Always add the description; a bare
   ticket number does not say what the worktree is for.
   - The ticket comes first, in exact Jira casing, followed by one hyphen, so
     ticket extraction keeps working.
   - The description is 2–5 words in PascalCase with no spaces or extra
     hyphens. Start with a verb when it reads naturally (`Fix`, `Add`,
     `Enable`, `Remove`) and keep it under about 40 characters.
   - Derive it from the Jira summary (`acli jira workitem view <TICKET> --json`)
     or the user's description of the work. Name what the work does, not the
     ticket's full title.
   - Tell the user the chosen name when creating it; they can rename it.
   - In M6 without a ticket, use the PascalCase description alone
     (e.g. `RydecentralGracefulShutdown`).
2. **Check for conflicts** before creating anything:
   ```bash
   git fetch origin
   git status --short --branch
   git worktree list
   git branch --list "<TICKET>*"
   git branch -r --list "*<TICKET>*"
   ```
   If a branch for the ticket already exists, ask whether to reuse it or
   create another with a different description rather than overwriting it.
3. **Branch from the latest default branch** (`origin/main` or
   `origin/master`) unless the user names another base:
   ```bash
   BASE=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
   ```
4. **Create it.** In worktree-based checkouts, run this from the current
   worktree root so the new worktree lands beside the existing ones, with a
   directory named like the branch. `--no-track` keeps the new branch from
   tracking `origin/$BASE`, which would make a later plain `git push` fail:
   ```bash
   git worktree add --no-track -b "<BRANCH>" "../<BRANCH>" "origin/$BASE"
   ```
   In a regular clone, use `git switch --no-track -c "<BRANCH>" "origin/$BASE"`.
5. Do not push the new branch until the user asks.

Release branches (`stage-release-*`, `prod-release-*`) follow the
`stage-release-pr` skill instead.

---

## Workflow — Regular Commits

When the user asks you to "commit", "commit this", "save this", or "create a
commit":

### Step 1: Determine the ticket

Follow [Determine Whether a Ticket Is Required](#determine-whether-a-ticket-is-required).

### Step 2: Gather staged and unstaged changes

```bash
# Staged
git diff --staged --stat

# Unstaged tracked files
git diff --stat

# Untracked
git status --short
```

### Step 3: Format EMSmart2.0 changes

When the repository is EMSmart2.0 and `EMSmartApi.sln` exists at the worktree
root, run formatting before drafting or executing the commit:

```bash
dotnet format EMSmartApi.sln
```

If formatting fails, stop and report the failure; do not commit. After a
successful format, rerun `git status --short` and review the resulting diff so
the commit message and staged files include all formatter changes.

Skip this step for other repositories.

### Step 4: Draft the commit message

Use a concise title followed by a short, natural explanation of what changed
and why. Include a caveat only when it helps the next engineer understand a
non-obvious constraint or tradeoff.

Format when a ticket is required or explicitly supplied:
```
TICKET: Summary of changes (imperative mood, ≤72 chars)

Explain what changed and why it was necessary. Mention any important caveat.
```

M6 format when no ticket was supplied:
```
Summary of changes (imperative mood, ≤72 chars)

Explain what changed and why it was necessary. Mention any important caveat.
```

Do not turn the body into a generated checklist. Avoid routine headings or
lines such as `Validation`, `Tests run`, and `Files changed`. Do not list build,
format, or test commands unless a failure or limitation is an important caveat.
Use bullets only when several distinct changes are genuinely easier to read
that way.

For example:
```
AM-18994: Support seed mode without SignalR

Use a no-op hub notification service while modern seed data is loading so the
seeder can satisfy its normal dependencies without requiring Redis. Regular
application startup still uses the real SignalR implementation.
```

### Step 5: Present to user; ask only if approval is still needed

For an authorized PR-feedback cycle, show the full intended commit message and
proceed to Step 6 without another question. An ordinary follow-up finding does
not reset that authorization. Honor any explicit local-only or no-push limit.

Otherwise, show the user the full commit message you intend to use. **Ask them to confirm**
before running `git commit`.

> "Here's the commit I've prepared. Please verify the title and description:
>
> ```
> AM-18994: Support seed mode without SignalR
> ```
>
> Proceed? (y/n)"

Wait for explicit approval. If they ask for changes, revise and re-present.

### Step 6: Execute

```bash
git commit -m "$TITLE" -m "$BODY"
```

After committing, respond naturally and briefly: give the commit hash and
summarize what the commit does and why. Mention a meaningful caveat when one
exists. Do not add separate `Validation` or `Tests run` lines, and do not repeat
routine command output.

---

## Workflow — Pushes

Push when the user explicitly asks or a scoped PR-feedback request implies
publication permission. Do not ask again within that cycle. Confirm the current
branch and its upstream, then use a normal push unless the branch history requires the safer
rewritten-history workflow.

```bash
# Branch already has an upstream with the same name
git push

# First push of a new branch (no upstream yet)
git push -u origin HEAD
```

Check with `git rev-parse --abbrev-ref --symbolic-full-name @{u}`. If the
upstream is the base branch (for example `origin/master`) instead of the
branch's own name, use `git push -u origin HEAD` so the push never targets the
base branch.

After pushing, state the branch and remote in one natural sentence. Add a
caveat only for something the user needs to act on, such as a rejected push or
missing upstream. Do not include routine validation or test summaries.

---

## Workflow — Merge Commits (into Stage)

When the user says "merge into stage", "create a merge commit", or "merge PR
into stage":

### Step 1: Determine the ticket (same as above)

### Step 2: Gather context about what's being merged

```bash
# See what branches/commits are involved
git log --oneline HEAD ^stage 2>/dev/null || git log --oneline -10
```

### Step 3: Draft the merge commit message

Format for merge commits:
```
TICKET: Merge <source-branch> into stage

<summary of what this merge brings>
```

### Step 4: **Must present for user verification**

This is critical. Before running `git merge` or creating a merge commit:

1. Show the full merge commit title and description
2. Ask the user to verify BOTH the title and description
3. Wait for explicit approval

> "Here's the merge commit I've prepared for merging into stage:
>
> **Title:** `AM-18994: Merge AM-18994 into stage`
> **Description:**
> ```
> Brings the seed-mode Redis/SignalR bypass into stage so the modern seeder
> can run without Redis.
> ```
>
> Please verify the title and description. Proceed with merge? (y/n)"

### Step 5: Execute on approval

```bash
git merge --no-ff <source-branch> -m "$TITLE" -m "$BODY"
```

---

## Workflow — Creating PRs

When the user asks to "create a PR", "open a PR", or "submit for review" for
a feature or fix branch. Promoting merged work to stage or prod with a release
branch follows the `stage-release-pr` skill instead; release titles use a
version, not a ticket.

### Step 1: Determine the ticket and base

- Ticket: follow [Determine Whether a Ticket Is Required](#determine-whether-a-ticket-is-required).
- Base: the repository's default branch unless the user names another (for
  example `stage`).
- Read the Jira summary with `acli jira workitem view <TICKET> --json` when the
  ticket exists; it is the usual starting point for the PR title.

### Step 2: Draft the title

```
TICKET: Title of the change or story
```

The title must describe the change on its own; a reviewer should understand it
without opening the ticket. Use the Jira story title when it describes this
change well; otherwise write a more specific one. In M6 without a ticket, use
the title alone.

### Step 3: Draft the description

The description has two parts: a **very brief scope summary** and the
**PR checklist** showing the steps performed before submitting.

**Scope summary** — 2–3 sentences covering what changed and why. That is
enough. Do not add long change lists, file inventories, or command logs.

**Checklist** — use the repository's PR template when one exists:

```bash
ls .github/ | grep -i pull_request_template
ls .github/PULL_REQUEST_TEMPLATE/ 2>/dev/null
```

- **Template exists:** keep its headings and checklist items verbatim and fill
  it in. Put the ticket in its `Ticket:` line (or its ticket/description field).
  Put the scope summary under the template's description section; if the
  template has none (the E2 backend templates only have `## Ticket` and the
  checklist), add a `## Summary` section right after the ticket line. Replace
  placeholder text instead of leaving it; write `None` for sections such as
  Breaking Changes that do not apply.
- **No template:** build the checklist from the steps that apply to the tech
  stack and were actually performed:
  - **.NET:** `dotnet format` passes; solution builds; unit tests added and
    passing; integration tests passing (if applicable); DI registrations
    verified for new services; migration SQL posted in the PR (if the PR has
    migrations — see `pr-migration-sql-autofill`).
  - **Angular / TypeScript:** lint passes; unit tests passing; production build
    succeeds; UI verified manually (with screenshots if visual).
  - **Python:** tests (`pytest`) passing; lint/format passes.
  - **Scripts / CI / infrastructure:** change exercised locally or in a dry
    run; Windows compatibility considered for developer-facing tooling.
  - **M6:** targeted tests for the changed area passing (per M6 local-testing
    policy); broad validation left to PR CI.

Checking boxes honestly:

- Check an item when it was done, or when it does not apply and the template
  says to leave N/A items checked (the E2 templates say
  "leave checked even if not applicable").
- Leave unchecked anything the user still has to do personally, such as posting
  test-run screenshots, Slack messages in `#ask-dba` / `#be-emsmart2`, or adding
  review labels. Do not add review labels unless the user asks. List these
  remaining items for the user when you present the PR.
- Never check a test or build item that was not actually run.

Example (E2 backend template):

```markdown
# Pull Request

## Ticket: AM-21222

## Summary

Logs origin and destination GPS coordinate changes on encounters so support
can trace when a location lookup overwrote user-entered coordinates. No schema
or API changes.

## Pre-submission Checklist (leave checked even if not applicable)

- [x] Dependencies (list URLs to related PRs)
- [x] Desk-checked the PR for errors, test failures, formatting, and clarity
- [x] Code follows C# Coding Conventions and General Programming Style Guidelines
- [x] Unit tests (mandatory) and integration tests (if applicable) are implemented
- [x] Ran both unit and integration tests successfully
- [ ] Posted a screenshot of the completed unit and integration test runs
...
```

(Keep the template's real links and full item list; the example shortens them.)

### Step 4: Present for verification

Show the full PR title and body, the base branch, and the unchecked items the
user still needs to handle. Ask for confirmation.

### Step 5: Create the PR

Approval to open the PR covers pushing the branch. `gh pr create` needs the
branch on the remote first, otherwise it stops to ask where to push. Push it
with the rules in [Pushes](#workflow--pushes).

Write the body to a temp file so Markdown and checkboxes survive quoting:

```bash
gh pr create --base "$BASE" --title "$TITLE" --body-file "$BODY_FILE"
```

- In `EMS-Management-Consultants/EMSmart2.0`, add the default reviewers from
  `AGENTS.md` (`--reviewer jdaily-emsmc,heath-ivie-emsmc,tuliotb`) unless the
  user names others.
- If the PR contains EF Core migrations, run `pr-migration-sql-autofill`.

Reply with the PR URL and the checklist items still waiting on the user.

---

## Notes

- Ticket extraction fails closed outside M6. If no supported Jira key is found,
  stop and ask for the correct ticket; never invent a placeholder. In the
  `EMS-Management-Consultants/M6` repository, no ticket is required and the
  title may omit the prefix.
- This skill works with git worktrees (primary use case), as well as direct
  branches in a regular clone.
- Keep commit, push, and completion prose natural and concise. Explain what and
  why; include caveats only when they matter. Omit routine validation and test
  reporting from commit messages. PR descriptions carry their checklist instead.
- Show the intended title/body and follow the applicable verification step.
  During an authorized PR-feedback cycle, do not pause for repeated commit/push
  approvals. Merging and opening a new PR still require their own approval.
- Before regular commits in EMSmart2.0, run `dotnet format EMSmartApi.sln` and
  review the formatter's changes. Never commit if formatting fails.
