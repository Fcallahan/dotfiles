---
name: claude-cli-dispatch
description: >
  When the user explicitly asks to run work through Claude Code or a Claude
  subagent, invoke the local `claude` CLI directly. Use Sonnet for routine
  review and Fable only for explicit or high-impact adjudication.
---

# Claude CLI Dispatch

Use this skill when the user explicitly requests work through Claude Code rather than merely discussing Claude, Pi, model routing, or account configuration.

## Prerequisites

- The `claude` CLI is installed and authenticated.
- Run from the relevant repository root.
- The active Claude CLI profile determines whether usage is subscription-backed or API-billed.

## Model routing

Use the cheapest model that provides the needed independent judgment:

- **Sonnet at high effort** — default for one bounded code review, adversarial review, finding verification, or other routine independent analysis.
- **Fable at high effort** — only when the user explicitly requests Fable, or for one concrete unresolved architecture, security, concurrency, data-integrity, conflicting-requirements, or unknown-root-cause decision. Fable may also adjudicate a disputed High/Critical Sonnet finding.
- **Never Opus** — do not invoke an Opus alias directly or allow accidental fallback to it.

Do not send routine review to Fable merely because the task is large, has several files, uses progress phases, or asks for quality.

## Invocation

Routine review or verification:

```bash
claude -p "<bounded task>" --model sonnet --effort high 2>&1
```

High-impact adjudication:

```bash
claude -p "<one concrete disputed question>" --model fable --effort high 2>&1
```

Always pass `--model` explicitly. Do not add `--bare`; it can bypass saved OAuth authentication and trusted settings. Preserve read-only scope for review tasks.

## Efficiency rules

- Handle local, low-risk work directly in Pi unless the user explicitly requests Claude.
- Use one consolidated reviewer over a bounded diff, not one reviewer per file.
- Pass exact diff scope, requirements paths, and verification already run; do not paste the parent transcript.
- Do not launch a separate verifier unless the first review leaves a disputed high-impact finding.
- Low findings never trigger another review. High and Medium fixes receive at most one bounded follow-up review.
- Run Claude tasks sequentially by default.

## Result handling

Capture the output in a repository review artifact when it will feed another agent. Report which model ran, why escalation was or was not warranted, and any residual risk.
