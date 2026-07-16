// ~/.pi/agent/workflows/saved/smoke-test.mjs
// Minimal end-to-end smoke test for the dynamic-workflows runtime: fans out
// one cheap subagent per unit, each writing a trivial JSON artifact.
// Dogfoods the portable homedir()-based dynamic-import preamble documented in
// ~/.pi/agent/skills/dynamic-workflows/SKILL.md.
// Usage: node ~/.pi/agent/workflows/saved/smoke-test.mjs [--force] [--retries 2] [--concurrency 16] [--harness pi|claude] [--warm] <unit...>
//
// --harness claude runs the same fan-out through the claude CLI harness
// instead of pi (role "reviewer", but with the model forced to "haiku" —
// the cheapest claude model — for this smoke test ONLY; real reviewer usage
// should not override the model like this). It exercises the harness spawn
// path, the artifact contract, and manifest/resume, not model quality.
// Requires a working `claude` CLI and an authenticated Claude subscription;
// keep unit counts small when using it, it's billed.
//
// --warm enables runUnits' warmStart option: with 3+ units this makes the
// solo-first-unit-then-fan-out ordering observable in the manifest's
// startedAt/finishedAt timestamps (scratch flag, local to this smoke test —
// see SKILL.md for the option itself).
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WF_LIB = join(homedir(), ".pi/agent/workflows/lib");
const { CHEAP_MODEL, spawnAgent } = await import(pathToFileURL(join(WF_LIB, "agent.mjs")).href);
const { parseWorkflowArgs, requireJsonFields, runUnits } = await import(pathToFileURL(join(WF_LIB, "runtime.mjs")).href);

// parseWorkflowArgs() doesn't know about --harness/--warm, so pull them out
// of argv first and hand the rest through unchanged.
const rawArgv = process.argv.slice(2);
let harness = "pi";
let warmStart = false;
const filteredArgv = [];
for (let i = 0; i < rawArgv.length; i++) {
  const arg = rawArgv[i];
  if (arg === "--harness") { harness = rawArgv[++i]; continue; }
  if (arg.startsWith("--harness=")) { harness = arg.slice("--harness=".length); continue; }
  if (arg === "--warm") { warmStart = true; continue; }
  filteredArgv.push(arg);
}

const args = parseWorkflowArgs(filteredArgv);
const units = args.positionals;
const CONCURRENCY = Number(args.concurrency ?? process.env.PI_WF_CONCURRENCY ?? 16);
const RETRIES = Number(args.retries ?? process.env.PI_WF_RETRIES ?? 2);

if (units.length === 0) {
  console.error("Usage: node ~/.pi/agent/workflows/saved/smoke-test.mjs [--force] [--retries 2] [--concurrency 16] [--harness pi|claude] [--warm] <unit...>");
  process.exit(2);
}

const resultSchema = requireJsonFields({ summary: "string" });

const run = await runUnits({
  name: "smoke-test",
  task: "Dynamic-workflows smoke test.",
  units,
  concurrency: CONCURRENCY,
  retries: RETRIES,
  resume: args.resume,
  force: args.force,
  warmStart,
  validate: resultSchema,
  worker: async (unit) => harness === "claude"
    ? spawnAgent({
        role: "reviewer",
        model: "haiku", // smoke-test override only — see file header comment.
        tools: "read",
        timeoutMs: 120_000,
        outputContract: '{ "summary": string }',
        prompt: `This is a smoke test of the dynamic-workflows CLAUDE harness. Your unit is "${unit}". Do not read or inspect any files. Reply with exactly this JSON object (substitute the literal unit value shown): {"summary":"echo ${unit}"}`,
      })
    : spawnAgent({
        model: CHEAP_MODEL,
        tools: "read",
        timeoutMs: 120_000,
        prompt: `This is a smoke test of the dynamic-workflows runtime. Your unit is "${unit}". Do not read or inspect any files. Reply with exactly this JSON object (substitute the literal unit value shown): {"summary":"echo ${unit}","findings":[],"confidence":1}`,
      }),
});

if (run.failed.length) {
  console.error(`FAILED: ${run.failed.length}/${units.length} unit(s); see ${run.manifestPath}`);
  process.exit(1);
}

console.log(`DONE: ${run.done.length} done, ${run.skipped.length} skipped → ${run.manifestPath}`);
