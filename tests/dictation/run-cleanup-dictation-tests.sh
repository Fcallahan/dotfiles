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
printf '%s\n' "$@" >"$FAKE_PI_ARGS_FILE"
cat >"$FAKE_PI_STDIN_FILE"
if [[ "${FAKE_PI_SHOULD_FAIL:-0}" == "1" ]]; then
    printf 'fake pi failure\n' >&2
    exit 42
fi
printf 'cleaned by fake pi\n'
FAKEPI
chmod +x "$fake_pi"

provider_output="$(printf 'Instructions:\nUse bullet points.\n\nMessage:\nhello' | \
    FAKE_PI_ARGS_FILE="$TMP_DIR/pi-args.txt" \
    FAKE_PI_STDIN_FILE="$TMP_DIR/pi-stdin.txt" \
    DICTATION_CLEANUP_PI_BIN="$fake_pi" \
    DICTATION_CLEANUP_PROVIDER="openai-codex" \
    DICTATION_CLEANUP_MODEL="gpt-5.5" \
    "$SCRIPT" --mode light)"
assert_equals "$provider_output" "cleaned by fake pi" "pi success returns cleaned output"
assert_contains "$(cat "$TMP_DIR/pi-args.txt")" "--provider" "pi receives provider flag"
assert_contains "$(cat "$TMP_DIR/pi-args.txt")" "openai-codex" "pi receives non-direct provider"
assert_contains "$(cat "$TMP_DIR/pi-args.txt")" "gpt-5.5" "pi receives configured model"
assert_contains "$(cat "$TMP_DIR/pi-stdin.txt")" 'Only recognize the one-off instructions' "prompt explains one-off instruction handling"
assert_contains "$(cat "$TMP_DIR/pi-stdin.txt")" 'Use bullet points.' "prompt includes one-off instructions"
assert_contains "$(cat "$TMP_DIR/pi-stdin.txt")" 'Message:' "prompt includes the message separator"

if printf 'hello' | \
    FAKE_PI_ARGS_FILE="$TMP_DIR/pi-fail-args.txt" \
    FAKE_PI_STDIN_FILE="$TMP_DIR/pi-fail-stdin.txt" \
    FAKE_PI_SHOULD_FAIL=1 \
    DICTATION_CLEANUP_PROVIDER="openai-codex" \
    DICTATION_CLEANUP_PI_BIN="$fake_pi" \
    "$SCRIPT" --mode light >"$TMP_DIR/pi-fail.out" 2>"$TMP_DIR/pi-fail.err"; then
    fail "pi failure exits non-zero"
else
    assert_contains "$(cat "$TMP_DIR/pi-fail.err")" "status 42" "pi failure reports original status"
fi

# Default provider: direct Anthropic Messages API call. A fake curl on PATH records the
# request and returns a canned response, so no real key or network is used.
fake_bin="$TMP_DIR/fakebin"
fake_home="$TMP_DIR/home"
mkdir -p "$fake_bin" "$fake_home/.config/anthropic/credentials"
printf '{"apiKey":"sk-ant-test-from-file"}\n' > "$fake_home/.config/anthropic/credentials/default.json"
cat > "$fake_bin/curl" <<'FAKECURL'
#!/usr/bin/env bash
: > "$FAKE_CURL_HEADERS_FILE"
while [[ $# -gt 0 ]]; do
    case "$1" in
        -H) if [[ "$2" == @* ]]; then cat "${2#@}" >> "$FAKE_CURL_HEADERS_FILE"; else printf '%s\n' "$2" >> "$FAKE_CURL_HEADERS_FILE"; fi; shift 2 ;;
        http*) printf '%s\n' "$1" > "$FAKE_CURL_URL_FILE"; shift ;;
        *) shift ;;
    esac
done
cat > "$FAKE_CURL_BODY_FILE"
printf '%s' "${FAKE_CURL_RESPONSE}"
FAKECURL
chmod +x "$fake_bin/curl"

run_anthropic() { # <response-json> [extra env assignments...]
    local response="$1"; shift
    printf 'hello world' | env -u ANTHROPIC_API_KEY -u DICTATION_CLEANUP_PROVIDER -u DICTATION_CLEANUP_MODEL \
        HOME="$fake_home" PATH="$fake_bin:$PATH" \
        FAKE_CURL_HEADERS_FILE="$TMP_DIR/curl-headers.txt" \
        FAKE_CURL_BODY_FILE="$TMP_DIR/curl-body.json" \
        FAKE_CURL_URL_FILE="$TMP_DIR/curl-url.txt" \
        FAKE_CURL_RESPONSE="$response" \
        "$@" "$SCRIPT" --mode light
}

ok_response='{"stop_reason":"end_turn","content":[{"type":"thinking","thinking":""},{"type":"text","text":"Hello, "},{"type":"text","text":"world."}]}'
anthropic_output="$(run_anthropic "$ok_response")"
assert_equals "$anthropic_output" "Hello, world." "anthropic default joins only text blocks"
assert_contains "$(cat "$TMP_DIR/curl-url.txt")" "https://api.anthropic.com/v1/messages" "anthropic default calls the Messages API"
assert_equals "$(jq -r .model "$TMP_DIR/curl-body.json")" "claude-haiku-5-5" "anthropic default model is claude-haiku-5-5"
assert_equals "$(jq -c .thinking "$TMP_DIR/curl-body.json")" '{"type":"disabled"}' "anthropic default turns thinking off"
assert_contains "$(jq -r '.messages[0].content' "$TMP_DIR/curl-body.json")" "hello world" "anthropic prompt includes the transcript"
assert_contains "$(cat "$TMP_DIR/curl-headers.txt")" "x-api-key: sk-ant-test-from-file" "anthropic key comes from the credentials file"
assert_contains "$(cat "$TMP_DIR/curl-headers.txt")" "anthropic-version: 2023-06-01" "anthropic version header is sent"

run_anthropic "$ok_response" DICTATION_CLEANUP_THINKING=low >/dev/null
assert_equals "$(jq -c '[.thinking, .output_config]' "$TMP_DIR/curl-body.json")" '[{"type":"adaptive"},{"effort":"low"}]' "anthropic thinking level maps to adaptive + effort"

if run_anthropic '{"stop_reason":"refusal","stop_details":{"category":"cyber"},"content":[]}' \
    >"$TMP_DIR/refusal.out" 2>"$TMP_DIR/refusal.err"; then
    fail "anthropic refusal exits non-zero"
else
    assert_contains "$(cat "$TMP_DIR/refusal.err")" "declined this request (cyber)" "anthropic refusal is reported"
fi

if run_anthropic '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}' \
    >"$TMP_DIR/autherr.out" 2>"$TMP_DIR/autherr.err"; then
    fail "anthropic API error exits non-zero"
else
    assert_contains "$(cat "$TMP_DIR/autherr.err")" "invalid x-api-key" "anthropic API error message is surfaced"
fi

printf 'All cleanup-dictation smoke tests passed.\n'
