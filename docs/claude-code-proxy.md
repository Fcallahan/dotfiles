# Claude Code through a ChatGPT subscription

This setup runs Claude Code against Codex models through
[`raine/claude-code-proxy`](https://github.com/raine/claude-code-proxy). Plain `claude` remains
authenticated directly with Anthropic. Proxy routing is enabled only by the `csol` and `cluna`
aliases in `zsh/.zshrc`.

The proxy and Claude Code run inside WSL/Linux. The proxy listens only on `127.0.0.1:18765` and has
no incoming-client authentication. Never bind it to `0.0.0.0`.

## Agent prompt

Give an AI agent this exact prompt after cloning the repository:

> Set up Claude Code through my ChatGPT subscription. Follow docs/claude-code-proxy.md exactly. Do
> not modify ~/.claude/settings.json, ~/.codex, or any Windows-side configuration. Do not expose
> OAuth credentials. Keep plain claude routed directly to Anthropic.

## Prerequisites

- Linux or WSL2 on `x86_64` or `aarch64`
- `claude` installed and authenticated with Anthropic
- `curl`, `file`, `jq`, `sha256sum`, `tar`, and `tmux`
- `~/.local/bin` on `PATH`

The root dotfiles installer links `zsh/.zshrc` and every script under `scripts/`:

```bash
cd ~/dotfiles
./install.sh
```

## Install the proxy

The installer uses the latest GitHub release, requires version `0.1.17` or newer, downloads the
matching Linux artifact and published checksum, verifies both the checksum and ELF type, then
installs the binary at `~/.local/bin/claude-code-proxy` with mode `0755`.

It never runs a remote shell script and never installs with Homebrew.

```bash
install-claude-code-proxy
claude-code-proxy --version
```

## Authenticate separately

No OpenAI API key is used. The proxy authenticates to the ChatGPT Codex backend with PKCE OAuth and
stores its own tokens under `~/.config/claude-code-proxy/`. Never copy or commit that directory, and
never inspect or print `codex/auth.json`.

Confirm the callback port is free, then try browser authentication:

```bash
ss -ltnp | grep 1455 || echo "1455 free"
if command -v wslview >/dev/null 2>&1; then
    BROWSER=wslview claude-code-proxy codex auth login
else
    claude-code-proxy codex auth login
fi
```

If no browser opens, copy the printed URL into a browser manually. If WSL localhost forwarding
stalls or the browser redirect fails, stop that command and use the
more reliable device-code flow:

```bash
claude-code-proxy codex auth device
```

Verify authentication without reading the credential file:

```bash
claude-code-proxy codex auth status
ls -l ~/.config/claude-code-proxy/codex/auth.json
```

The credential file must be mode `0600`. This credential store is intentionally separate from
`~/.codex/`; do not copy or modify standalone Codex CLI credentials.

## Start and use the proxy

Confirm the port is free, then start the monitor in tmux:

```bash
ss -ltnp | grep 18765 || echo "18765 free"
tmux new-session -d -s ccp 'claude-code-proxy serve'
curl -fsS http://127.0.0.1:18765/healthz && echo OK
tmux attach -t ccp
```

Detach from tmux with `Ctrl+B`, then `D`. No systemd unit or autostart is configured.

Start a fresh shell before using the aliases:

```bash
csol   # GPT-5.6 Sol
cluna  # GPT-5.6 Luna
```

The aliases set routing variables for one launched Claude process only:

- `ANTHROPIC_BASE_URL` points Claude Code at the loopback proxy.
- `ANTHROPIC_AUTH_TOKEN=unused` fills Claude Code's required auth slot. It is not a credential and is
  discarded at the loopback boundary.
- `ANTHROPIC_MODEL` selects the primary Codex model.
- `ANTHROPIC_SMALL_FAST_MODEL` routes Claude's background title/token requests to a supported model.
- `[1m]` is a Claude-local context hint stripped by the proxy before the upstream request.
- `CLAUDE_CODE_AUTO_COMPACT_WINDOW=272000` starts local compaction at 272K tokens.
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` reduces unrelated traffic.
- `CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK=1` prevents retries that can duplicate tool calls.

Claude Code may label the session as **API usage billing** because it sees a token-shaped placeholder
and custom endpoint. That label does not describe the proxy's upstream billing. Confirm actual
routing in the monitor: successful requests must show provider `codex` and the intended model.
Claude's `/cost` output may likewise be an API-price estimate rather than an actual charge.

## Verify Anthropic separation

Run these checks from a fresh shell:

```bash
claude auth status
claude -p "what model are you?" --output-format text
env | grep '^ANTHROPIC' || echo "no ANTHROPIC variables"
grep -nE 'ANTHROPIC_BASE_URL|ANTHROPIC_MODEL' ~/.claude/settings.json || echo "no proxy routing in settings"
```

Plain `claude` must still report first-party Anthropic authentication and a Claude model. The fresh
shell must have no `ANTHROPIC_*` variables. The proxy aliases do not set `CLAUDE_CONFIG_DIR`, so local
plugins, skills, and MCP server definitions remain shared. Claude.ai-hosted connectors are normally
disabled while the custom token auth source is active.

## Known limitations

- The documented subscription context limit is disputed between 272K and 372K. Start with 272K.
  Watch for an upstream HTTP 400 stating that input exceeds the context window before experimenting
  with a higher compaction threshold.
- Codex reasoning blocks are not forwarded. Optional reasoning summaries become Anthropic-style
  thinking blocks, so simple requests may show no thinking.
- Claude's `/effort` maps to Codex `low`, `medium`, `high`, `xhigh`, or `max`. `ultra` is unavailable.
- ChatGPT rate limits are shared across every client on the account. Limit exhaustion appears as HTTP
  429 with `retry-after`.
- `/model` can switch between models handled by the proxy. Moving between the proxy and direct
  Anthropic requires relaunching Claude Code.
- Model access varies by ChatGPT plan. Unsupported models return the upstream HTTP 400 unchanged.
- Public comments supporting alternate harnesses are not binding policy and do not prevent future
  terms or enforcement changes.

## After a WSL restart

```bash
tmux new-session -d -s ccp 'claude-code-proxy serve'
csol
```

## Rollback

```bash
tmux kill-session -t ccp
claude-code-proxy codex auth logout
rm ~/.local/bin/claude-code-proxy
rm -rf ~/.config/claude-code-proxy ~/.local/state/claude-code-proxy
```

Then delete the `csol` and `cluna` alias lines and their preceding comment from `~/.zshrc`. No proxy
environment variables belong in `~/.claude/settings.json`; if any were added manually, remove them.
