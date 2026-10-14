#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const packageDir = process.env.PI_SUBAGENTS_DIR
  ? path.resolve(process.env.PI_SUBAGENTS_DIR)
  : path.join(os.homedir(), ".pi/agent/npm/node_modules/pi-subagents");
const stalePath = path.join(packageDir, "src/runs/background/stale-run-reconciler.ts");
const statusPath = path.join(packageDir, "src/runs/background/run-status.ts");
const notifyPath = path.join(packageDir, "src/runs/background/notify.ts");

for (const file of [stalePath, statusPath, notifyPath]) {
  assert.ok(fs.existsSync(file), `Missing installed source: ${file}`);
}
const staleSource = fs.readFileSync(stalePath, "utf8");
const statusSource = fs.readFileSync(statusPath, "utf8");
const notifySource = fs.readFileSync(notifyPath, "utf8");
assert.doesNotMatch(staleSource, /data\.state.*paused.*\|\|.*data\.exitCode.*0/);
assert.doesNotMatch(statusSource, /data\.state.*paused.*\|\|.*data\.exitCode.*0/);
assert.doesNotMatch(notifySource, /result\.exitCode\s*===\s*0/);
assert.match(staleSource, /is dead but run was left in "paused" state/);

const requireFromPackage = createRequire(path.join(packageDir, "package.json"));
const { createJiti } = requireFromPackage("jiti");
const jiti = createJiti(import.meta.url);
const { reconcileAsyncRun } = await jiti.import(stalePath);
const { buildCompletionDetails } = await jiti.import(notifyPath);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-paused-repair-smoke-"));
try {
  const asyncDir = path.join(root, "run-paused-dead");
  const resultsDir = path.join(root, "results");
  fs.mkdirSync(asyncDir, { recursive: true });
  fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({
    runId: "run-paused-dead",
    mode: "single",
    state: "paused",
    pid: 12345,
    startedAt: 1000,
    lastUpdate: 1000,
    steps: [{ agent: "worker", status: "paused", startedAt: 1000 }],
  }, null, 2));

  const repaired = reconcileAsyncRun(asyncDir, {
    resultsDir,
    kill: () => {
      const error = new Error("dead");
      error.code = "ESRCH";
      throw error;
    },
    now: () => 2000,
  });
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.status?.state, "failed");
  assert.match(repaired.message ?? "", /dead but run was left in "paused" state/);

  assert.equal(buildCompletionDetails({
    id: "zero-exit-failure",
    agent: "worker",
    success: false,
    exitCode: 0,
    summary: "failed without explicit paused state",
    timestamp: 1,
  }).status, "failed");
  assert.equal(buildCompletionDetails({
    id: "explicit-pause",
    agent: "worker",
    success: false,
    state: "paused",
    summary: "Paused after interrupt.",
    timestamp: 1,
  }).status, "paused");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("Paused-run repair semantic smoke test passed.");
