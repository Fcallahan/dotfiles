# Claude CLI provider for Pi

Registers `claude-cli/fable-5.1` as a Pi model while using the personal Claude Code CLI profile and its Claude Max subscription.

## Data flow

1. Pi sends the user turn to one long-lived Claude Agent SDK `query()` process pinned to `claude-fable-5-1`.
2. The subprocess uses `~/.claude-personal`, removes ambient Anthropic API/proxy variables, and verifies the expected personal account email before every session.
3. Claude Code owns its normal tools, project instructions, permissions, and conversation history.
4. OpenAI Codex `gpt-5.6-luna` rewrites Claude's final text for clarity and concision.
5. Integrity checks fall back to Claude's original text if protected technical content is lost.

The editor receives Claude's final draft plus your latest user request. Claude's tool transcript is not sent to the editor.

## Pi controls

- Select `/model` → `claude-cli/fable-5.1`.
- Use Pi's thinking control to choose low, medium, or high Claude effort.
- `/claude-editor on|off` controls Luna rewriting for the current Pi session.
- `/claude-status` shows the mapped Claude session and the most recent editor fallback.
- `/claude-tasks` shows the Claude Agent SDK's own background `Task` tool calls
  for the current session (see below).
- `/new` creates a new Claude conversation.
- `/resume` restores the Claude conversation mapped to that Pi session.

Pi tree navigation and compaction reset the live Claude mapping and seed a new Claude conversation from the active Pi context. Explicit Claude subagents remain separate from this main conversation.

## Background Task visibility (best-effort)

While Claude runs a turn through this bridge, it can call its own internal
`Task` tool to spawn sub-agents (including ones dispatched in the background,
like the ones this repo's `subagent`/`pi-subagents` extensions track for pure
Pi sessions). Those runs write an append-only JSONL transcript per task to an
**undocumented, internal SDK path**:

```
{tmpdir}/claude-{uid}/{slugified cwd}/{claude session id}/tasks/{taskId}.output
```

(`.output` entries are sometimes plain files while actively written, and
sometimes symlinks into `~/.claude/projects/.../subagents/*.jsonl` once
rotated to their persistent home - `background-tasks.ts` handles both.)

`background-tasks.ts` polls that directory every 2s while a Claude CLI session
exists and surfaces a compact footer status, e.g.:

```
⚙ 2 claude bg tasks (Explore 3m12s, coder 1m04s)
```

`/claude-tasks` lists each task's id, label (from the transcript's
`attributionAgent`), a preview of its prompt, elapsed time, and output path.

**This is intentionally best-effort, not authoritative.** There is no
completion event on disk for these tasks - liveness is inferred purely from
how recently the output file was modified (a task not touched in 20s is shown
as idle/finished). The path layout itself is a private implementation detail
of `@anthropic-ai/claude-agent-sdk` and could change between SDK versions;
every filesystem access in `background-tasks.ts` is wrapped so a layout change
degrades to "no background tasks shown" rather than an error. Compare this to
`managed-background-jobs`, which owns real `state.json` files and can report
authoritative status/exit codes - prefer dispatching through that extension
wherever the caller controls how the work is launched.

## Security boundary

The Claude subprocess is pinned to the personal profile at `~/.claude-personal`. It strips `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and `ANTHROPIC_BASE_URL` from its child environment, then fails closed unless Claude reports the configured personal account and a Claude.ai subscription. This prevents Pi's Fable route from silently using the EMSMC API key or enterprise seat.

With the editor enabled, Claude's final answer and your latest request are sent to `openai-codex/gpt-5.6-luna`. Disable the editor before handling responses that must remain within Claude Code.

## Development

```bash
npm install
npm run check
npm test
```
