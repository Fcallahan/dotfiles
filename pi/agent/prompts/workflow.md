---
description: Author and run a dynamic multi-agent workflow for a task.
argument-hint: "<task>"
---
You are an orchestrator. Do NOT solve the task turn-by-turn in this context. Instead, write a Node ESM orchestrator script and run it.

Task: $ARGUMENTS

Rules:
1. Import `spawnAgent` and `CHEAP_MODEL` from
   `file:///home/jet44/.pi/agent/workflows/lib/agent.mjs`.
2. Import `runUnits`, `requireJsonFields`, `parseWorkflowArgs`, and when useful
   `fileFingerprint` from `file:///home/jet44/.pi/agent/workflows/lib/runtime.mjs`.
3. Decompose the task into independent units of work. Fan them out with
   `runUnits({ name, units, concurrency: 16, retries: 2, worker })` — one
   isolated `spawnAgent` per unit. Use `fingerprint: fileFingerprint` for file
   units so changed files rerun while unchanged completed units resume.
4. If quality matters, add an adversarial verification phase: a SEPARATE
   `runUnits(...)` stage whose worker uses `spawnAgent({ tools: "read,bash", ... })`
   to try to refute each finding before it counts. Use majority for judgment calls.
5. Keep loops, routing, filtering, retries, resume state, and stop conditions in JS
   — not in prose. The goal lives in the script, restated to each agent, so it
   never drifts.
6. Route bounded/repetitive stages to `CHEAP_MODEL`; keep judgment on the default.
7. Each stage must validate artifacts with `requireJsonFields(...)` or a custom
   validator. If a stage needs a custom JSON shape, pass `outputContract` to
   `spawnAgent` and the matching `validate` function to `runUnits`.
8. Write the script to `.pi/workflows/<slug>.mjs` in the project, run it with
   `node`, and report ONLY the final merged artifact — not intermediate output.

Before writing, state the phase plan in 3–5 lines. Then write and run.
