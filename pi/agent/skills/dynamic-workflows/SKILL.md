---
name: dynamic-workflows
description: >-
  Decide when to use pi dynamic workflows: model-authored Node orchestrators that
  fan out isolated headless pi subprocesses, keep loops/state/retries in code,
  resume from manifests, and adversarially verify results. Use for broad
  multi-file audits, repeated per-file/per-module analysis, large deterministic
  fan-out, batch classification, repository-wide searches needing judgment, and
  tasks where missing units would be costly. Do not use for simple single-file
  edits or ordinary implementation unless explicit batching/verification is
  needed.
---

# Dynamic Workflows

Use this skill when the task is better handled by a generated Node workflow than by one long model turn or ordinary conversational subagents.

## Core idea

Write a project-local Node ESM orchestrator in `.pi/workflows/<slug>.mjs`. The script, not the chat model, owns:

- unit discovery
- loops
- concurrency
- retries
- resume state
- branching/filtering
- adversarial verification
- final report merging

Each unit calls `spawnAgent()` to launch a fresh, isolated, headless `pi -p` subprocess. Coordination glue is plain Node and spends no model tokens.

## Decision rubric

Prefer a dynamic workflow when at least two are true:

- The task spans many files, modules, packages, routes, services, commits, test failures, or findings.
- There is a natural unit list: files, directories, endpoints, components, PR findings, errors, DB models, etc.
- Completeness matters: every unit must be checked, not “a representative sample.”
- Results need independent verification or majority judgment.
- A long run may fail and should resume without redoing completed work.
- The same prompt should be applied repeatedly with bounded concurrency.
- The task is analysis/audit/classification/search-heavy rather than a small edit.

Prefer normal pi behavior/subagents when:

- The task is a small direct answer or single-file change.
- There is one coherent implementation path and no large fan-out.
- The built-in `worker`/`reviewer`/`planner` chain gives enough structure.
- Multiple writers would touch the same worktree. Keep writes single-threaded unless using explicit worktree isolation.

## Required imports

Use absolute file URLs so generated workflows work from any project:

```js
import { spawnAgent, CHEAP_MODEL } from "file:///home/jet44/.pi/agent/workflows/lib/agent.mjs";
import {
  runUnits,
  requireJsonFields,
  parseWorkflowArgs,
  fileFingerprint,
  slugify,
} from "file:///home/jet44/.pi/agent/workflows/lib/runtime.mjs";
```

## Standard workflow shape

1. State a 3-5 line phase plan.
2. Create `.pi/workflows/` if needed.
3. Write `.pi/workflows/<slug>.mjs`.
4. Run it with the `run_dynamic_workflow` tool when available; fall back to `node` via bash only if that tool is unavailable.
5. Report only the final merged artifact and manifest paths.

Scripts should support:

```bash
--force          # ignore previous artifacts
--no-resume      # rerun this invocation without reusing done units
--retries 2
--concurrency 16
```

When using `run_dynamic_workflow`, pass those controls as tool parameters (`force`, `noResume`, `retries`, `concurrency`) and pass unit paths/items in `args`.

## Skeleton

```js
import { mkdir, writeFile } from "node:fs/promises";
import { spawnAgent, CHEAP_MODEL } from "file:///home/jet44/.pi/agent/workflows/lib/agent.mjs";
import { runUnits, requireJsonFields, parseWorkflowArgs, fileFingerprint } from "file:///home/jet44/.pi/agent/workflows/lib/runtime.mjs";

const args = parseWorkflowArgs();
const CONCURRENCY = Number(args.concurrency ?? process.env.PI_WF_CONCURRENCY ?? 16);
const RETRIES = Number(args.retries ?? process.env.PI_WF_RETRIES ?? 2);

await mkdir(".pi/workflows", { recursive: true });

// Replace with deterministic unit discovery for the task.
const units = args.positionals;
if (units.length === 0) {
  console.error("Usage: node .pi/workflows/<slug>.mjs [--force] [--retries 2] [--concurrency 16] <unit...>");
  process.exit(2);
}

const resultSchema = requireJsonFields({ summary: "string", findings: "array", confidence: "number" });

const phase1 = await runUnits({
  name: "<slug>-phase1",
  task: "<short stable task description>",
  units,
  concurrency: CONCURRENCY,
  retries: RETRIES,
  resume: args.resume,
  force: args.force,
  fingerprint: fileFingerprint, // use only when units are files
  validate: resultSchema,
  worker: async (unit) => spawnAgent({
    tools: "read,bash",
    prompt: `Analyze ${unit} for <task>. Return concrete evidence only. Empty findings array if clean.`,
  }),
});

if (phase1.failed.length) {
  throw new Error(`Phase 1 failed for ${phase1.failed.length} unit(s); see ${phase1.manifestPath}`);
}

const candidates = phase1.units.flatMap((u) =>
  (u.result?.findings ?? []).map((finding) => ({ unit: u.unit, finding }))
);

const verifySchema = requireJsonFields({ verdict: "string", reason: "string", confidence: "number" });

const phase2 = await runUnits({
  name: "<slug>-verify",
  task: "Adversarially verify candidate findings.",
  units: candidates,
  concurrency: CONCURRENCY,
  retries: RETRIES,
  resume: args.resume,
  force: args.force,
  validate: verifySchema,
  worker: async (candidate) => spawnAgent({
    tools: "read,bash",
    model: CHEAP_MODEL,
    outputContract: '{ "verdict": "confirmed" | "rejected", "reason": string, "confidence": number }',
    prompt: `Try to REFUTE this finding. Confirm only with concrete evidence: ${JSON.stringify(candidate)}`,
  }),
});

if (phase2.failed.length) {
  throw new Error(`Phase 2 failed for ${phase2.failed.length} unit(s); see ${phase2.manifestPath}`);
}

const confirmed = phase2.units
  .filter((u) => u.result?.verdict === "confirmed")
  .map((u) => ({ ...u.unit, verification: u.result }));

await writeFile("workflow-report.md",
  `# Workflow report\n\n` +
  `Phase 1 manifest: ${phase1.manifestPath}\n\n` +
  `Phase 2 manifest: ${phase2.manifestPath}\n\n` +
  `Confirmed: ${confirmed.length}\n\n` +
  confirmed.map((c) => `## ${c.unit}\n${c.verification.reason}\n\n\`\`\`json\n${JSON.stringify(c.finding, null, 2)}\n\`\`\``).join("\n\n"),
  "utf8"
);

console.log(`DONE: ${confirmed.length} confirmed → workflow-report.md`);
```

## Subagent prompting rules

- Restate the global goal inside every `spawnAgent()` prompt.
- Give each subagent one unit or one verification target.
- Use `tools: "read,bash"` for review/verification. `spawnAgent()` adds `write` only for the required artifact.
- Use `outputContract` whenever the JSON shape differs from `{ summary, findings, confidence }`.
- Use `CHEAP_MODEL` for bounded repetitive verification/classification; use the default model for nuanced judgment.
- Treat `ok: false`, invalid schema, and missing artifacts as retryable failures via `runUnits()`.

## Reporting rules

Final response should include only:

- final report path
- confirmed counts
- failed unit counts, if any
- manifest paths for audit/resume
- how to rerun/resume

Do not paste every intermediate subagent result into chat.

## Safety rules

- Do not use dynamic workflows to launch many concurrent writers into the same worktree.
- For implementation tasks, prefer one writer and use dynamic workflows for read-only discovery/review/verification around it.
- Keep generated scripts project-local in `.pi/workflows/`; keep reusable scripts in `~/.pi/agent/workflows/saved/` only when the user asks to save them.
- If no deterministic unit list can be produced, ask one clarifying question or use normal pi subagents instead.
