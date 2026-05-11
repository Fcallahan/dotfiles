#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/dictation/cleanup-dictation"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local label="$3"
    if [[ "$haystack" == *"$needle"* ]]; then
        pass "$label"
    else
        printf 'Expected to find: %s\nIn output: %s\n' "$needle" "$haystack" >&2
        fail "$label"
    fi
}

assert_equals() {
    local actual="$1"
    local expected="$2"
    local label="$3"
    if [[ "$actual" == "$expected" ]]; then
        pass "$label"
    else
        printf 'Expected: %s\nActual:   %s\n' "$expected" "$actual" >&2
        fail "$label"
    fi
}

if [[ ! -x "$SCRIPT" ]]; then
    fail "cleanup script exists and is executable"
fi

help_output="$($SCRIPT --help)"
assert_contains "$help_output" "Usage: cleanup-dictation" "help prints usage"

if printf '' | DICTATION_CLEANUP_SKIP_LLM=1 "$SCRIPT" --mode light >"$TMP_DIR/empty.out" 2>"$TMP_DIR/empty.err"; then
    fail "empty stdin exits non-zero"
else
    assert_contains "$(cat "$TMP_DIR/empty.err")" "No input text provided" "empty stdin reports useful error"
fi

if printf 'hello' | DICTATION_CLEANUP_SKIP_LLM=1 "$SCRIPT" --mode formal >"$TMP_DIR/invalid.out" 2>"$TMP_DIR/invalid.err"; then
    fail "invalid mode exits non-zero"
else
    assert_contains "$(cat "$TMP_DIR/invalid.err")" "Invalid mode" "invalid mode reports useful error"
fi

cat >"$TMP_DIR/replacements.tsv" <<'TSV'
m status	EMStatus
local stack	LocalStack
signal r	SignalR
TSV

output="$(printf 'm status uses local stack and signal r' | \
    DICTATION_CLEANUP_SKIP_LLM=1 \
    DICTATION_CLEANUP_REPLACEMENTS="$TMP_DIR/replacements.tsv" \
    "$SCRIPT" --mode light)"
assert_equals "$output" "EMStatus uses LocalStack and SignalR" "skip-llm applies deterministic replacements"

polish_output="$(printf 'please polish m status' | \
    DICTATION_CLEANUP_SKIP_LLM=1 \
    DICTATION_CLEANUP_REPLACEMENTS="$TMP_DIR/replacements.tsv" \
    "$SCRIPT" --mode polish)"
assert_equals "$polish_output" "please polish EMStatus" "polish mode is accepted in skip-llm mode"

fake_pi="$TMP_DIR/fake-pi"
cat >"$fake_pi" <<'FAKEPI'
#!/usr/bin/env bash
printf 'fake pi failure\n' >&2
exit 42
FAKEPI
chmod +x "$fake_pi"

if printf 'hello' | DICTATION_CLEANUP_PI_BIN="$fake_pi" "$SCRIPT" --mode light >"$TMP_DIR/pi-fail.out" 2>"$TMP_DIR/pi-fail.err"; then
    fail "pi failure exits non-zero"
else
    assert_contains "$(cat "$TMP_DIR/pi-fail.err")" "status 42" "pi failure reports original status"
fi

printf 'All cleanup-dictation smoke tests passed.\n'
