#!/usr/bin/env bash
# extract-ticket.sh — Extract ticket number from the current git worktree or branch
#
# Returns the ticket number (e.g. AM-18994, EMSVC-444) or exits with code 1.
#
# Detection logic preserves the Jira key exactly:
#   - EMSmart2.0 repos → AM-XXXXX
#   - BR / EMStatus / NEMSIS → EMSVC-XXXXX or EMV-XXXXX
#
# Usage: ./extract-ticket.sh [path]
#   path: optional repo path (defaults to cwd)

set -euo pipefail

TARGET_DIR="${1:-$(pwd)}"

# ── Step 1: determine project type from git remote ──────────────────────────
PROJECT_TYPE=""
REMOTE_URL=""
if REMOTE_URL="$(cd "$TARGET_DIR" && git remote get-url origin 2>/dev/null)"; then
  case "$REMOTE_URL" in
    *EMSmart2.0*|*emsmart*|*ems2*)
      PROJECT_TYPE="emsmart"
      ;;
    *BR/*|*billing-rules*|*BillingRules*|*emstatus*|*EMStatus*)
      PROJECT_TYPE="br"
      ;;
    *EMSmart2.0-Client-Application*|*emsmart2-client*)
      PROJECT_TYPE="emsmart"
      ;;
    *)
      PROJECT_TYPE="unknown"
      ;;
  esac
fi

# ── Step 2: get current branch name ─────────────────────────────────────────
BRANCH=""
if BRANCH="$(cd "$TARGET_DIR" && git branch --show-current 2>/dev/null)"; then
  :
fi

# ── Step 3: extract ticket from worktree path or branch ─────────────────────
TICKET=""

# Try to extract from the git worktree list (shows the worktree path)
WORKTREE_PATH=""
if WORKTREE_PATH="$(cd "$TARGET_DIR" && git worktree list --porcelain 2>/dev/null | head -1)"; then
  # First line after "worktree <path>" — skip that line
  :
fi

# The most reliable source: extract from .git/worktrees/<name>
if [ -d "$TARGET_DIR/.git/worktrees" ]; then
  for wt in "$TARGET_DIR"/.git/worktrees/*/; do
    wt_name="$(basename "$wt")"
    case "$PROJECT_TYPE" in
      emsmart)
        if [[ "$wt_name" =~ ^(AM-[0-9]+) ]]; then
          TICKET="${BASH_REMATCH[1]}"
          break
        fi
        ;;
      br)
        if [[ "$wt_name" =~ ^(EMSVC-[0-9]+) ]]; then
          TICKET="${BASH_REMATCH[1]}"
          break
        fi
        if [[ "$wt_name" =~ ^(EMV-[0-9]+) ]]; then
          TICKET="${BASH_REMATCH[1]}"
          break
        fi
        ;;
      *)
        # Generic: preserve any supported ticket key.
        if [[ "$wt_name" =~ ^(AM-[0-9]+) ]]; then
          TICKET="${BASH_REMATCH[1]}"
          break
        fi
        if [[ "$wt_name" =~ ^(EMSVC-[0-9]+) ]]; then
          TICKET="${BASH_REMATCH[1]}"
          break
        fi
        if [[ "$wt_name" =~ ^(EMV-[0-9]+) ]]; then
          TICKET="${BASH_REMATCH[1]}"
          break
        fi
        ;;
    esac
  done
fi

# ── Step 4: fallback — try extracting from the branch name ──────────────────
if [ -z "$TICKET" ] && [ -n "$BRANCH" ]; then
  case "$PROJECT_TYPE" in
    emsmart)
      if [[ "$BRANCH" =~ (AM-[0-9]+) ]]; then
        TICKET="${BASH_REMATCH[1]}"
      fi
      ;;
    br)
      if [[ "$BRANCH" =~ (EMSVC-[0-9]+) ]]; then
        TICKET="${BASH_REMATCH[1]}"
      elif [[ "$BRANCH" =~ (EMV-[0-9]+) ]]; then
        TICKET="${BASH_REMATCH[1]}"
      fi
      ;;
    *)
      if [[ "$BRANCH" =~ (AM-[0-9]+) ]]; then
        TICKET="${BASH_REMATCH[1]}"
      elif [[ "$BRANCH" =~ (EMSVC-[0-9]+) ]]; then
        TICKET="${BASH_REMATCH[1]}"
      elif [[ "$BRANCH" =~ (EMV-[0-9]+) ]]; then
        TICKET="${BASH_REMATCH[1]}"
      fi
      ;;
  esac
fi

# ── Step 5: fallback — the repo path itself might contain the ticket ────────
if [ -z "$TICKET" ]; then
  REPO_DIR="$(basename "$(cd "$TARGET_DIR" && git rev-parse --show-toplevel 2>/dev/null || echo "$TARGET_DIR")")"
  case "$PROJECT_TYPE" in
    emsmart)
      if [[ "$REPO_DIR" =~ (AM-[0-9]+) ]]; then
        TICKET="${BASH_REMATCH[1]}"
      fi
      ;;
    br)
      if [[ "$REPO_DIR" =~ (EMV-[0-9]+) ]]; then
        TICKET="${BASH_REMATCH[1]}"
      fi
      ;;
  esac
fi

# ── Output ───────────────────────────────────────────────────────────────────
if [ -n "$TICKET" ]; then
  echo "$TICKET"
else
  echo "Unable to determine Jira ticket from worktree, branch, or repository path" >&2
  exit 1
fi