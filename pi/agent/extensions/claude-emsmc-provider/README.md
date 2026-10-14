# Claude EMSMC provider for Pi

Registers `claude-emsmc/opus` and `claude-emsmc/sonnet` as Pi models, bridged through the
real Claude Code CLI — same underlying mechanism as `claude-cli-provider`'s `fable` model —
but authenticated with the **EMSMC company Anthropic API key**, never the personal Claude.ai
subscription. Keep the two providers separate: this one exists specifically to keep company
work off the personal subscription account and off any non-Anthropic model.

## Setup

Export the company key under this exact variable name before starting Pi:

```bash
export EMSMC_ANTHROPIC_API_KEY="sk-ant-..."
```

If it's unset, `claude-emsmc/*` refuses to start a session rather than silently falling back
to anything else.

## Data flow

1. Pi sends the user turn to a Claude Agent SDK `query()` subprocess, same as `fable`.
2. That subprocess's environment is fully replaced (not merged) with `EMSMC_ANTHROPIC_API_KEY`
   set as `ANTHROPIC_API_KEY`, so it can never inherit an ambient `claude auth login` session
   or another provider's credentials.
3. Before sending, and on every turn, the session checks `accountInfo()` and aborts if it
   ever resolves to a Claude.ai subscription — the inverse of `fable`'s own subscription
   check. A misconfigured key fails loudly instead of quietly running on the wrong account.
4. **There is no editor/rewrite step.** `claude-cli-provider`'s `fable` model sends Claude's
   final answer and your last message to `openai-codex/gpt-5.6-luna` for a clarity pass by
   default. That code path does not exist in this extension at all — not defaulted off,
   simply not present — because company data must never take that hop.

## Pi controls

- Select `/model` → `claude-emsmc/opus` or `claude-emsmc/sonnet`.
- Switching between the two tiers mid-conversation starts a fresh Claude session rather than
  silently continuing the previous tier's session.
- `/claude-emsmc-status` shows the mapped Claude session, active tier, and whether the API
  key env var is set.
- `/new` creates a new Claude conversation; `/resume` restores the one mapped to that Pi
  session.

## What this does not cover

Claude's own internal subagent dispatch (its `Task` tool, e.g. `coder`/`oracle` per Claude
Code's own CLAUDE.md orchestration rules) runs inside the same subprocess and inherits this
same EMSMC-keyed auth automatically — that part is safe by construction.

Pi's own separate subagent system (`pi-subagents`, via `/agent` or workflow dispatch) is a
different code path that does **not** know this model is active. As of this writing,
`~/.pi/agent/settings.json` has no `subagents.agentOverrides` configured at all, so any
Pi-level subagent role (`oracle`, `reviewer`, `scout`, etc.) falls back to the session's
`defaultModel`/`defaultProvider` (currently DeepSeek via OpenRouter), regardless of whether
`claude-emsmc` is the active top-level model. Using `/agent` or a workflow while doing EMSMC
work can still route through a non-Anthropic provider. Locking that down needs a follow-up
change to `subagents.agentOverrides` (or a stricter provider-lock extension, on the model of
`openrouter-deepseek-only.ts`), not something this provider extension can enforce by itself.

Fable (`claude-cli/fable`) is untouched by this extension — it keeps its own session,
its own subscription auth, and its own editor pass exactly as before.
