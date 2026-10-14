---
description: Author and run a dynamic multi-agent workflow for a task.
argument-hint: "<task>"
---
You are an orchestrator. Do NOT solve the task turn-by-turn in this context. Instead, write a Node ESM orchestrator script and run it.

Task: $ARGUMENTS

Rules:
1. Build workflow imports from `os.homedir()` and `pathToFileURL`; never hard-code a user home path.
2. Import `spawnAgent` and `CHEAP_MODEL` from `~/.pi/agent/workflows/lib/agent.mjs`.
3. Import `runUnits`, `requireJsonFields`, `parseWorkflowArgs`, and when useful `fileFingerprint` from `~/.pi/agent/workflows/lib/runtime.mjs`.
4. Decompose the task into independent units only when there is a real unit list. Use `runUnits({ name, units, concurrency: 6, retries: 2, worker })` as the default; lower concurrency for Claude-harness roles or expensive tools. Use `fingerprint: fileFingerprint` for file units so changed files rerun while unchanged completed units resume.
5. Do not add a verification stage merely because quality matters. For a normal risky changed-code or PR review, use one consolidated Sonnet reviewer over the bounded diff. Add a separate verifier only when the first review leaves a disputed high-impact finding, or when independent per-unit refutation is the task itself.
6. Keep loops, routing, filtering, retries, resume state, and stop conditions in JS
   — not in prose. The goal lives in the script, restated to each agent, so it
   never drifts.
7. Route genuine bounded/repetitive discovery to `CHEAP_MODEL`; use Sonnet for one consolidated routine review. Reserve Fable for a concrete unresolved architecture, security, concurrency, data-integrity, conflicting-requirements, or unknown-root-cause decision.
8. Prefer direct parent execution when there is no real independent unit list. Prefer one consolidated review over a bounded diff when the unit list would otherwise be "one reviewer per file" without a real independence benefit.
9. Each stage must validate artifacts with `requireJsonFields(...)` or a custom
   validator. If a stage needs a custom JSON shape, pass `outputContract` to
   `spawnAgent` and the matching `validate` function to `runUnits`.
10. Write the script to `.pi/workflows/<slug>.mjs` in the project, run it with
   `run_dynamic_workflow` when available, and report ONLY the final merged artifact and manifest paths — not intermediate output.

Before writing, state the phase plan in 3–5 lines. Then write and run.
