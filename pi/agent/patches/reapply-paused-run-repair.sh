#!/usr/bin/env bash
# Reapply the tested pi-subagents paused-run repair after package updates.
# Safe states:
#   - already patched/upstream-fixed: verify and exit 0
#   - known vulnerable source: apply patch, verify, exit 0
#   - vulnerable but changed source: fail closed with remediation

set -euo pipefail

PKG_DIR="${PI_SUBAGENTS_DIR:-$HOME/.pi/agent/npm/node_modules/pi-subagents}"
PATCH_FILE="$HOME/.pi/agent/patches/pi-subagents-paused-run-repair.patch"
VERIFY_FILE="$HOME/.pi/agent/patches/verify-paused-run-repair.mjs"

if [[ ! -d "$PKG_DIR" ]]; then
    echo "ERROR: $PKG_DIR not found — is pi-subagents installed?" >&2
    exit 1
fi

version=$(node -p "require('$PKG_DIR/package.json').version" 2>/dev/null || echo "unknown")

is_semantically_fixed() {
    ! grep -Eq 'data\.state.*paused.*\|\|.*data\.exitCode.*0' \
        "$PKG_DIR/src/runs/background/stale-run-reconciler.ts" \
        "$PKG_DIR/src/runs/background/run-status.ts" \
    && ! grep -Eq 'result\.exitCode[[:space:]]*===[[:space:]]*0' "$PKG_DIR/src/runs/background/notify.ts" \
    && grep -Fq 'is dead but run was left in "paused" state' "$PKG_DIR/src/runs/background/stale-run-reconciler.ts"
}

verify_repair() {
    PI_SUBAGENTS_DIR="$PKG_DIR" node --experimental-strip-types "$VERIFY_FILE"
}

if is_semantically_fixed; then
    verify_repair
    echo "Paused-run repair already present in pi-subagents v$version."
    exit 0
fi

if patch -p1 -d "$PKG_DIR" --dry-run -f < "$PATCH_FILE" >/dev/null 2>&1; then
    patch -p1 -d "$PKG_DIR" < "$PATCH_FILE"
    verify_repair
    echo "Applied and verified paused-run repair for pi-subagents v$version."
    echo "Restart active pi sessions to load the repaired source."
    exit 0
fi

echo "ERROR: pi-subagents v$version is still vulnerable, but the tested patch no longer applies cleanly." >&2
echo "Installation stopped rather than silently reactivating the paused-run defect." >&2
echo "Rebuild the patch against this version and run its upstream regression tests." >&2
exit 1
