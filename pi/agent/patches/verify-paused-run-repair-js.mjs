#!/usr/bin/env node
// Semantic smoke test for the paused-run repair on pi-subagents releases that ship compiled .js
// (0.7x+). Same checks as verify-paused-run-repair.mjs (the .ts layout), plus a namespace guard.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const packageDir = process.env.PI_SUBAGENTS_DIR
  ? path.resolve(process.env.PI_SUBAGENTS_DIR)
  : path.join(os.homedir(), ".pi/agent/npm/node_modules/pi-subagents");
const bg = path.join(packageDir, "src/runs/background");
const stalePath = path.join(bg, "stale-run-reconciler.js");
const statusPath = path.join(bg, "run-status.js");
const notifyPath = path.join(bg, "notify.js");

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

const { reconcileAsyncRun } = await import(pathToFileURL(stalePath).href);
const { buildCompletionDetails } = await import(pathToFileURL(notifyPath).href);

const dead = () => {
  const error = new Error("dead");
  error.code = "ESRCH";
  throw error;
};
const pausedRun = (asyncDir, extra = {}) => {
  fs.mkdirSync(asyncDir, { recursive: true });
  fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({
    runId: path.basename(asyncDir),
    mode: "single",
    state: "paused",
    pid: 12345,
    startedAt: 1000,
    lastUpdate: 1000,
    steps: [{ agent: "worker", status: "paused", startedAt: 1000 }],
    ...extra,
  }, null, 2));
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-paused-repair-smoke-"));
try {
  const resultsDir = path.join(root, "results");

  // Paused run whose runner died: repaired to failed.
  const deadDir = path.join(root, "run-paused-dead");
  pausedRun(deadDir);
  const repaired = reconcileAsyncRun(deadDir, { resultsDir, kill: dead, now: () => 2000 });
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.status?.state, "failed");
  assert.match(repaired.message ?? JSON.stringify(repaired.status ?? {}), /dead but run was left in "paused" state/);

  // Paused run whose runner is alive: left alone (still resumable).
  const aliveDir = path.join(root, "run-paused-alive");
  pausedRun(aliveDir);
  const alive = reconcileAsyncRun(aliveDir, { resultsDir, kill: () => true, now: () => 2000 });
  assert.equal(alive.repaired, false);

  // PID recorded in another namespace: cannot be judged dead from here, left alone.
  const foreignDir = path.join(root, "run-paused-foreign-ns");
  pausedRun(foreignDir, { pidNamespaceScope: "pid:[4026531836]" });
  const foreign = reconcileAsyncRun(foreignDir, {
    resultsDir, kill: dead, now: () => 2000, pidNamespaceScope: () => "pid:[4026532999]",
  });
  assert.equal(foreign.repaired, false);

  // exitCode 0 without success is a failure, not a pause.
  assert.equal(buildCompletionDetails({
    id: "zero-exit-failure", agent: "worker", success: false, exitCode: 0,
    summary: "failed without explicit paused state", timestamp: 1,
  }).status, "failed");
  // An explicit pause is still a pause.
  assert.equal(buildCompletionDetails({
    id: "explicit-pause", agent: "worker", success: false, state: "paused",
    summary: "Paused after interrupt.", timestamp: 1,
  }).status, "paused");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("Paused-run repair semantic smoke test passed (.js layout).");
