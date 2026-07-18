#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────
# diff-review: start a Pi review session in Neovim
# ──────────────────────────────────────────────────────────

MODE="diff"       # "diff" or "commit"
REF="HEAD"
REPO_ROOT=""

usage() {
  echo "Usage: $(basename "$0") [--commit <hash>] [--pr <number>] [<ref>]"
  echo ""
  echo "  <ref>             Diff working tree vs <ref> (default: HEAD)"
  echo "  --commit <hash>   Show a single commit diff"
  echo "  --pr    <number>  Fetch and diff a GitHub PR"
  exit 1
}

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit) MODE="commit"; shift; REF="${1:-}"; shift ;;
    --pr)     MODE="pr";     shift; REF="${1:-}"; shift ;;
    -h|--help) usage ;;
    *)        REF="$1"; shift ;;
  esac
done

# Find repo root
if ! REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  echo "Error: not in a git repository" >&2
  exit 1
fi

REPO_NAME="$(basename "$REPO_ROOT")"

# Determine scope and generate diff
case "$MODE" in
  diff)
    SCOPE="${REF}"
    if [[ "$SCOPE" == "HEAD" ]]; then
      SCOPE="working-tree"
    fi
    echo "Generating diff: working tree vs ${REF}..."
    DIFF="$(git diff "$REF" 2>/dev/null || true)"
    # Include staged changes if present
    STAGED="$(git diff --cached 2>/dev/null || true)"
    if [[ -n "$STAGED" ]]; then
      DIFF="${DIFF}"$'\n'"${STAGED}"
    fi
    if [[ -z "$DIFF" ]]; then
      echo "No changes to review." >&2
      exit 0
    fi
    ;;

  commit)
    SCOPE="commit-${REF}"
    echo "Generating diff for commit ${REF}..."
    DIFF="$(git show "$REF" --format="" -p 2>/dev/null || true)"
    if [[ -z "$DIFF" ]]; then
      echo "Commit ${REF} not found." >&2
      exit 1
    fi
    ;;

  pr)
    if ! command -v gh &>/dev/null; then
      echo "Error: gh CLI is required for --pr mode" >&2
      exit 1
    fi
    SCOPE="pr-${REF}"
    echo "Fetching diff for PR #${REF}..."
    DIFF="$(gh pr diff "$REF" 2>/dev/null || true)"
    if [[ -z "$DIFF" ]]; then
      echo "PR #${REF} not found or gh not authenticated." >&2
      exit 1
    fi
    ;;
esac

# Create review directory
REVIEWS_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/nvim/reviews/${REPO_NAME}/${SCOPE}"
mkdir -p "$REVIEWS_DIR"

# Write diff file
DIFF_FILE="${REVIEWS_DIR}/diff.patch"
echo "$DIFF" > "$DIFF_FILE"

# Create/ensure JSON comments file
JSON_FILE="${REVIEWS_DIR}/review.json"
if [[ ! -f "$JSON_FILE" ]]; then
  CREATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  cat > "$JSON_FILE" <<-EOF
{
  "version": 2,
  "repo": "${REPO_ROOT}",
  "diff": "${DIFF_FILE}",
  "scope": "${SCOPE}",
  "createdAt": "${CREATED_AT}",
  "updatedAt": "${CREATED_AT}",
  "comments": []
}
EOF
fi

echo "───────────────────────────────────────────────"
echo "  Repository: ${REPO_NAME}"
echo "  Scope:      ${SCOPE}"
echo "  Diff file:  ${DIFF_FILE}"
echo "  Comments:   ${JSON_FILE}"
echo "───────────────────────────────────────────────"
echo "Opening Neovim with pi_review..."
echo ""

# Launch Neovim with env vars for pi_review auto-start
PI_REVIEW_ROOT="${REPO_ROOT}" \
PI_REVIEW_DIFF="${DIFF_FILE}" \
PI_REVIEW_JSON="${JSON_FILE}" \
PI_REVIEW_SCOPE="${SCOPE}" \
PI_REVIEW_BACKEND="diffview" \
  nvim "${DIFF_FILE}"