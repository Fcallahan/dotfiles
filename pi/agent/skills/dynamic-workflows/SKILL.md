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

Build the lib URLs from `os.homedir()` so generated workflows work on any machine, then dynamically import (top-level await is legal in `.mjs`):

```js
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WF_LIB = join(homedir(), ".pi/agent/workflows/lib");
const { spawnAgent, CHEAP_MODEL, SMART_MODEL, agentForRole, ROLES } = await import(pathToFileURL(join(WF_LIB, "agent.mjs")).href);
const { runUnits, requireJsonFields, parseWorkflowArgs, fileFingerprint, slugify } =
  await import(pathToFileURL(join(WF_LIB, "runtime.mjs")).href);
```

## Harnesses and role-based routing

`spawnAgent()` can run each unit through one of two harnesses:

- `harness: "pi"` (default, unchanged) — spawns the local `pi` CLI, OpenRouter-routed models (`CHEAP_MODEL`/`DEFAULT_MODEL`/deepseek).
- `harness: "claude"` — spawns the user's `claude` CLI (subscription auth, no `provider` option) via `stream-json` so the same first-stdout-byte watchdog and artifact-write contract apply identically. Tool names are mapped from this lib's pi-style list (`read,bash,edit,write,grep,find,ls`) to claude's `--allowedTools` (`Read,Bash,Edit,Write,Grep,Glob`); `Write` is always included. The framed prompt is fed over stdin (not argv) — see "Claude settings-source isolation" below for what else this harness sets.

Rather than set `harness`/`model` by hand, pass a **role** — either directly to `spawnAgent({ role: "reviewer", ... })` (explicit `harness`/`model` in the same call still win) or via `agentForRole(role, overrides)`:

```js
const { harness, model } = agentForRole("verifier", { timeoutMs: 5 * 60_000 });
```

### ROLES table

| role | harness | model | timeoutMs | use for |
|---|---|---|---|---|
| `planner` | claude | `PI_WF_PLANNER_MODEL` ?? `"fable"` | 30 min | up-front plan/approach for a workflow |
| `architect` | claude | `PI_WF_ARCHITECT_MODEL` ?? `"fable"` | 30 min | design/structural decisions |
| `reviewer` | claude | `PI_WF_REVIEWER_MODEL` ?? `SMART_MODEL` | default (15 min) | code/finding review |
| `verifier` | claude | `PI_WF_VERIFIER_MODEL` ?? `"sonnet"` | default (15 min) | adversarial verification (refute-or-confirm) |
| `scout` | pi | `CHEAP_MODEL` | default (15 min) | broad low-judgment scanning |
| `mapper` | pi | `CHEAP_MODEL` | default (15 min) | mapping/indexing units |
| `classifier` | pi | `CHEAP_MODEL` | default (15 min) | bulk classification |
| `worker` | pi | `DEFAULT_MODEL` | default (15 min) | default/mechanical work; fallback for unknown roles |

**Routing guidance:** `planner`/`architect` are the lowest-volume, deepest-judgment phases (one up-front plan, one design decision per workflow) — they default to `fable`, the deepest-reasoning model, since volume is low enough that cost is a non-issue; their turns can run long, hence the 30-minute `timeoutMs` (a caller-supplied `timeoutMs` in the same `spawnAgent`/`agentForRole` call still wins — role defaults are the fallback, not a ceiling). `verifier` is the highest-volume judgment phase (adversarial verification across many candidates) — it defaults to `sonnet`: near-opus judgment quality for confirm/refute work, cheaper and drawing from a separate rate-limit window than fable/opus, so wide verifier fan-outs don't compete with planner/architect/reviewer for the same subscription budget. `reviewer` is unchanged (`SMART_MODEL`, i.e. `"opus"` by default). Volume phases — scanning, mapping, classification, mechanical work — use `scout`/`mapper`/`classifier`/`worker` (pi/deepseek). Claude units draw on the user's subscription rate limits: **keep claude fan-outs narrow** (concurrency is capped at `PI_WF_CLAUDE_CONCURRENCY` — default 3 — regardless of the workflow's own `--concurrency`) and prefer deepseek roles for anything high-volume.

### Claude settings-source isolation

A bare `claude -p` child loads the user/project/local settings sources by default, which pulls this user's `~/.claude/CLAUDE.md` (global infra notes, model-dispatch policy, commit rules — see that file for the full list) and its auto-memory into every headless subagent. That's irrelevant-to-conflicting context for a narrow spawned unit, wastes tokens, and — worse for this lib's purposes — makes the prompt prefix differ per machine/user, defeating provider-side prompt caching.

The claude harness therefore passes `--setting-sources ""` by default (verified empirically against claude 2.1.211): this excludes all three sources — user `CLAUDE.md`/memory, project `CLAUDE.md`/`.claude/settings.json`, and local `.claude/settings.local.json` — while leaving subscription auth intact (auth lives under `~/.claude` but is credential storage, not a "setting source," so it's unaffected).

Escape hatch: set `PI_WF_CLAUDE_SETTINGS_SOURCES=default` or `=1` to skip the isolation flag entirely and fall back to claude's normal default sources (today's un-isolated behavior). Any other value is passed through verbatim as the `--setting-sources` value — e.g. `PI_WF_CLAUDE_SETTINGS_SOURCES=project,local` to keep project-level conventions for whatever repo the subagent's `cwd` happens to be, while still dropping the user's global `CLAUDE.md`.

### Prompt layout for cache hits

`spawnAgent()`'s framed prompt is deliberately split so byte-identical-across-units content comes first/on the system side, and unique-per-unit content comes last, on the user side:

- The static artifact-write contract (write-tool instructions + `Required shape: ${outputContract}`) lives in `--append-system-prompt`, not the user prompt. `outputContract` is stable within a phase, so this text is byte-identical across every unit of one `runUnits()` call — that's what lets Anthropic/OpenRouter/deepseek prompt caching hit on the shared prefix. (Per-unit file *paths* used to carry this — the pi harness still needs `@file` — differ every time, but that's fine: caching hashes the file's content once read, not its path.)
- The user-side prompt is `${prompt}` (the caller's actual unit prompt) FIRST, then one short unique line at the very end: `Write your JSON result to this exact path: ${outPath}`.

When writing your own workflow's `prompt`/`appendSystemPrompt`, follow the same rule: keep the shared/static preamble for a phase's units byte-identical (no interpolated unit-specific values), and put anything unit-specific — file paths, IDs, per-unit context — at the very end of the user prompt, never in the middle and never before the caller's own task text.

### Env knobs

- `PI_WF_SMART_MODEL` (default `"opus"`) — smart model used by `reviewer` (and any role whose own default still points at `SMART_MODEL`) unless overridden per-role. `"fable"` also works on this subscription if you want to switch.
- `PI_WF_PLANNER_MODEL` / `PI_WF_ARCHITECT_MODEL` — per-role overrides for `planner`/`architect`, falling back to `"fable"` (not `PI_WF_SMART_MODEL`).
- `PI_WF_REVIEWER_MODEL` — override for `reviewer`, falling back to `PI_WF_SMART_MODEL`.
- `PI_WF_VERIFIER_MODEL` — override for `verifier`, falling back to `"sonnet"` (not `PI_WF_SMART_MODEL`).
- `PI_WF_CLAUDE_CONCURRENCY` (default `3`) — max concurrent claude children across the whole process, independent of `runUnits`' `concurrency`.
- `PI_WF_CLAUDE_BIN` (default `"claude"`) — override the claude binary/path if it's not on `PATH`.
- `PI_WF_CLAUDE_SETTINGS_SOURCES` — controls the claude harness's settings-source isolation (see "Claude settings-source isolation" above). `"default"`/`"1"` disable isolation; any other value is passed through verbatim as `--setting-sources`.

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

### `warmStart`

Pass `warmStart: true` to `runUnits({ ... })` to warm the provider-side prompt cache before fanning out. When 2+ units still have real work to do (not already `done` with a valid artifact from a resumed manifest), the first such pending unit runs to completion alone — sequentially, no concurrent siblings — and only then do the remaining units fan out at the normal configured `concurrency`.

Why: a fully-parallel start means every unit's first request races to populate the shared-prefix prompt cache at the same instant, so none of them can read a cache entry a concurrent sibling is still writing — the whole first wave misses. Running one unit alone first lets its request finish and the cache entry land before anyone else starts, so the rest of the fan-out can actually hit it. This only pays off when the phase's units share a byte-identical prefix — see "Prompt layout for cache hits" above.

Resumed-run exception: a run where every unit is already `done`/skipped is unaffected (nothing pending, so nothing runs solo), and a run with exactly one pending unit left is also unaffected (2+ pending is required — no point serializing a single unit ahead of an empty fan-out).

- Runtime env knobs (all optional): `PI_WF_FIRST_RESPONSE_MS` (watchdog for a subagent's first stdout byte, default 60000, 0 disables), `PI_WF_KEEP_TMP=1` (keep each subagent's tmp dir after a successful run instead of cleaning it up), `PI_WF_STRICT_AWAIT=1` (exit non-zero if any `spawnAgent()` call is created but never awaited), `PI_WF_NO_SANDBOX=1` (skip the Node permission-model sandbox flags the extension normally prepends). See "Harnesses and role-based routing" above for the claude-harness-specific knobs (`PI_WF_SMART_MODEL`, per-role model overrides, `PI_WF_CLAUDE_CONCURRENCY`, `PI_WF_CLAUDE_BIN`).

### Usage accounting & failure diagnostics

`spawnAgent()`'s result carries `usage` on both success and failure:

```js
usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd }
```

Fields are omitted (not present, not `0`) when the underlying data wasn't available — e.g. a watchdog-killed child that never emitted a single event has no `usage` at all. Sourced from each harness's own NDJSON stream (parsed line-by-line as it arrives, not from the final artifact):

- pi (`--mode json`): every `message_end` event with `message.role === "assistant"` carries per-call `message.usage.{input,output,cacheRead,cacheWrite,cost.total}`. This is **per model call, not cumulative** across a multi-turn tool-using run, so `spawnAgent()` sums it across every such event before returning.
- claude (`--output-format stream-json --verbose`): the single terminal `{"type":"result",...}` event carries cumulative `usage.input_tokens` / `usage.output_tokens` / `usage.cache_read_input_tokens` / `usage.cache_creation_input_tokens` and a top-level `total_cost_usd`.

`runUnits()` surfaces each unit's `usage` onto its manifest entry (`manifest.units[key].worker.usage`) and maintains a run-level `totalUsage` (same shape, summed across every unit/attempt, including failed ones — a failed or rate-limited attempt can still have burned real tokens/cost). `totalUsage` is a top-level manifest field and is also returned from `runUnits(...)`; it's carried forward across `--resume` invocations rather than reset, so it reflects cumulative spend across a run's whole history.

Failure returns from `spawnAgent()` also carry `stderrTail`: the last ~2048 chars of the child's stderr, for diagnosing what went wrong straight from `manifest.json` without re-running anything. Omitted on success. `runUnits()` surfaces it onto the manifest entry the same way as `usage`.

### Rate-limit-aware retries (claude harness)

When a claude-harness child fails, `spawnAgent()` classifies the failure using `classifyRateLimited(resultEvent, stderrTail)` (exported from `agent.mjs`) — a small, deliberately extensible marker list (`rate limit`, `usage limit`, `overloaded`, HTTP 429/529, matched against the parsed terminal `result` event and the stderr tail). When it matches, the failure return carries `rateLimited: true`.

`runUnits()`'s retry loop treats a `rateLimited` failure specially: instead of the normal `retryDelayMs`, it waits `PI_WF_RATELIMIT_BACKOFF_MS` (default 60000) before the next attempt — honoring `signal` abort during the wait, so Ctrl-C doesn't hang behind a backoff — and, mirroring the existing aborted-attempt handling, does **not** count that attempt against the unit's retry budget. This free pass is capped at 3 per unit (tracked as `entry.rateLimitWaits` on the manifest); beyond that, further failures consume the normal retry budget like any other failure, so a persistently rate-limited unit still eventually lands on `failed` instead of retrying forever.

### Retry escalation

`runUnits({ escalate, ... })` accepts either a role-name string (resolved via `agentForRole` from `agent.mjs`, e.g. `"verifier"` → `{ harness: "claude", model: "sonnet" }`) or a plain object of `spawnAgent` overrides (e.g. `{ harness: "claude", model: "sonnet" }` directly). When set, a unit's **final allowed attempt** (the one that exhausts the retry budget if it also fails) gets `ctx.overrides` set to the resolved object on the worker's context; every earlier attempt gets `ctx.overrides === undefined`. Workers opt in explicitly by spreading it last:

```js
worker: async (unit, ctx) => spawnAgent({
  ...agentForRole("worker"),
  tools: "read,bash",
  prompt: `...`,
  ...(ctx.overrides ?? {}), // last attempt only: bumps harness/model per `escalate`
}),
```

A worker that ignores `ctx.overrides` simply never escalates — the option is inert unless the worker spreads it in. When an attempt actually runs escalated, `runUnits()` records `entry.escalated = true` on the manifest entry (persists across `--resume`) so escalated units are auditable after the fact without re-running anything. This is a single last-attempt bump, not a per-attempt ladder — there is no array of models tried in sequence.

### Budget ceiling

`runUnits({ maxCostUsd, maxTotalTokens, ... })` accepts two optional budget ceilings, checked against the run's cumulative `totalUsage` after each unit finishes. When either is met or exceeded:

- New unit starts are paused: any unit not yet started stays `pending` on the manifest with `skippedReason: "budget_exceeded"` (not marked `failed` — a later `--resume` with a higher ceiling picks it back up, and the stale `skippedReason` is cleared once it actually runs).
- Units already in flight run to completion (the ceiling check only gates the *next* unit a free concurrency slot would start, not an already-dispatched one).
- One `console.error` line is logged the moment the ceiling trips.
- Return counts (`done`/`failed`/`pending`/`running`) still add up to `total`.

## Context packs: scouts index, planners read

When a `scout`/`mapper` phase runs ahead of a `planner`/`architect` phase (e.g. map the codebase first, then hand the map to a planning unit), the scout/mapper units must return a **structured index**, not a summary or a recommendation:

```json
{
  "file": "src/Infrastructure/ConfigureServices.cs",
  "role": "DI registration root",
  "keySymbols": [{ "name": "ConfigureInfrastructureServices", "lines": "42-58" }],
  "dependsOn": ["src/Domain/Interfaces/ILcdService.cs"],
  "verbatim": [{ "lines": "42-58", "code": "public static IServiceCollection ConfigureInfrastructureServices(...)\n{\n    services.AddScoped<ILcdService, LcdService>();\n    ...\n}" }]
}
```

Rules for the scout/mapper prompt:

- **Index, don't summarize.** `keySymbols`/`dependsOn`/`verbatim` are pointers and exact snippets, not prose descriptions of what the code does.
- `verbatim` snippets are load-bearing code copied exactly (the actual lines), never paraphrased logic — a paraphrase can silently drop or misstate a condition that matters to the planner's decision.
- No `recommendations`, `verdict`, or `nextSteps` fields — judgment belongs to the planner/architect reading the pack, not to the scout producing it.

Rules for the planner/architect prompt that consumes the pack:

- Pass the assembled pack (the merged scout/mapper results) as context in the prompt, but also give the planner/architect **read tools** (`tools: "read,bash"` at minimum) and instruct it to open and read the files the pack flags as load-bearing before deciding.
- State explicitly in the prompt: "This index narrows where to look — it does not replace reading the flagged files yourself. Read them before proposing a plan/design."
- The pack is a map, not a substitute for the territory: a planner that only reads the pack and never opens a file can act on a scout's mis-copied line range or a since-changed file.

## Skeleton

```js
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WF_LIB = join(homedir(), ".pi/agent/workflows/lib");
const { spawnAgent, CHEAP_MODEL, agentForRole } = await import(pathToFileURL(join(WF_LIB, "agent.mjs")).href);
const { runUnits, requireJsonFields, parseWorkflowArgs, fileFingerprint } =
  await import(pathToFileURL(join(WF_LIB, "runtime.mjs")).href);

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
  // escalate: "verifier", // uncomment to bump the FINAL attempt only to
  // claude/sonnet (agentForRole("verifier")) when cheaper attempts keep
  // failing/validating-wrong — see "Retry escalation" above. Requires the
  // worker below to actually spread ctx.overrides in.
  worker: async (candidate, ctx) => spawnAgent({
    tools: "read,bash",
    model: CHEAP_MODEL,
    // For higher-stakes adversarial verification, swap the line above for:
    //   ...agentForRole("verifier"), tools: "read,bash",
    // to route through the claude/sonnet harness instead — narrow the
    // workflow's concurrency when doing so (PI_WF_CLAUDE_CONCURRENCY caps it
    // regardless, but keep the fan-out itself small).
    outputContract: '{ "verdict": "confirmed" | "rejected", "reason": string, "confidence": number }',
    prompt: `Try to REFUTE this finding. Confirm only with concrete evidence: ${JSON.stringify(candidate)}`,
    ...(ctx.overrides ?? {}), // last attempt only, when `escalate` is set above
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
- For judgment-heavy phases, prefer `agentForRole("planner"|"architect"|"reviewer"|"verifier")` (claude harness; fable for planner/architect, opus for reviewer, sonnet for verifier — see the ROLES table above) over hand-setting `harness`/`model`; keep those fan-outs narrow (`PI_WF_CLAUDE_CONCURRENCY`, default 3) since they draw on the user's claude subscription rate limits. Keep high-volume phases on `scout`/`mapper`/`classifier`/`worker` (pi/deepseek).
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

## Hard-won QC rules (July 2026 audit)

- **Preflight before fan-out.** Verify cwd is a git worktree, disk has headroom, and worker auth (`gh`/`acli`/`claude` CLIs) resolves before spawning any subprocess — 3 runs once died at creation because cwd was `$HOME`, and a WSL `HOME` redirect broke all worker auth for a day.
- **Checkpoint eagerly.** Append every completed worker's result to an on-disk checkpoint file at completion time; never let results exist only in orchestrator memory until final synthesis — a 25-agent review run lost 2 confirmed bugs to a session limit at delivery time.
- **Route models by pre-classified shard size.** Know shard size before dispatch: shards with ≤2 items or mechanical verification stages (re-grep, line-number correction) go to a cheap tier (Sonnet-class); reserve premium models (Opus/Fable-class) for large/ambiguous shards and true adversarial-disprove cycles. The audit measured ~58% of premium-tier tokens going to worker stages a cheap model could handle.
- **Synthesis challenges, never re-derives.** A synthesis/verify stage's prompt must present the prior stage's conclusion and ask it to confirm or falsify with cited evidence — not hand over a raw evidence pack. One synthesis stage burned 132k premium tokens fully re-investigating a conclusion a prior 141k-token stage had already established.
- **Grant repro permissions up front.** Adversarial-review workers told to reproduce behavior (copy repo to `/tmp` and diff, sandboxed clone, run tests) must be spawned with those commands pre-allowed — audited workers were denied their own required repro steps and silently degraded to static analysis.
