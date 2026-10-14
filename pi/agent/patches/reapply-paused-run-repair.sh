#!/usr/bin/env bash
# Reapply the tested pi-subagents paused-run repair after package updates.
# Safe states:
#   - already patched/upstream-fixed: verify and exit 0
#   - known vulnerable source: apply patch, verify, exit 0
#   - vulnerable but changed source: fail closed with remediation

set -euo pipefail

PKG_DIR="${PI_SUBAGENTS_DIR:-$HOME/.pi/agent/npm/node_modules/pi-subagents}"
PATCHES="$HOME/.pi/agent/patches"

if [[ ! -d "$PKG_DIR" ]]; then
    echo "ERROR: $PKG_DIR not found — is pi-subagents installed?" >&2
    exit 1
fi

# Older releases ship TypeScript sources; 0.7x+ ship compiled JavaScript.
if [[ -f "$PKG_DIR/src/runs/background/notify.ts" ]]; then
    EXT=ts
    PATCH_FILE="$PATCHES/pi-subagents-paused-run-repair.patch"
    VERIFY_FILE="$PATCHES/verify-paused-run-repair.mjs"
elif [[ -f "$PKG_DIR/src/runs/background/notify.js" ]]; then
    EXT=js
    PATCH_FILE="$PATCHES/pi-subagents-paused-run-repair-js-v0.78.0.patch"
    VERIFY_FILE="$PATCHES/verify-paused-run-repair-js.mjs"
else
    echo "ERROR: unrecognised pi-subagents layout in $PKG_DIR (no src/runs/background/notify.{ts,js})." >&2
    exit 1
fi
BG="$PKG_DIR/src/runs/background"

version=$(node -p "require('$PKG_DIR/package.json').version" 2>/dev/null || echo "unknown")

is_semantically_fixed() {
    ! grep -Eq 'data\.state.*paused.*\|\|.*data\.exitCode.*0' \
        "$BG/stale-run-reconciler.$EXT" \
        "$BG/run-status.$EXT" \
    && ! grep -Eq 'result\.exitCode[[:space:]]*===[[:space:]]*0' "$BG/notify.$EXT" \
    && grep -Fq 'is dead but run was left in "paused" state' "$BG/stale-run-reconciler.$EXT"
}

verify_repair() {
    if [[ $EXT == ts ]]; then
        PI_SUBAGENTS_DIR="$PKG_DIR" node --experimental-strip-types "$VERIFY_FILE"
    else
        PI_SUBAGENTS_DIR="$PKG_DIR" node "$VERIFY_FILE"
    fi
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
