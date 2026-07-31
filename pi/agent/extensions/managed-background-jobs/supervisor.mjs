#!/usr/bin/env node

import { spawn } from "node:child_process";
import { closeSync, existsSync, fstatSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const specPath = process.argv[2];
if (!specPath) process.exit(2);

const dir = dirname(specPath);
const statePath = join(dir, "state.json");
const outputPath = join(dir, "output.log");
const rotatedOutputPath = `${outputPath}.1`;
const controlPath = join(dir, "control.json");
const spec = JSON.parse(await readFile(specPath, "utf8"));
let child;
let outputFd;
let stopRequested = false;
let timedOut = false;
let forceTimer;
let state = JSON.parse(await readFile(statePath, "utf8"));
const configuredMaxBytes = Number(process.env.PI_BACKGROUND_JOB_MAX_BYTES);
const maxOutputBytes = Number.isFinite(configuredMaxBytes) && configuredMaxBytes >= 1_048_576
  ? Math.floor(configuredMaxBytes)
  : 10 * 1024 * 1024;
let outputBytes = 0;
let saveQueue = Promise.resolve();

function save(patch) {
  saveQueue = saveQueue.then(async () => {
    const now = new Date().toISOString();
    state = { ...state, ...patch, updatedAt: now };
    const temp = `${statePath}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temp, statePath);
  });
  return saveQueue;
}

function openLog() {
  outputFd = openSync(outputPath, "a");
  outputBytes = fstatSync(outputFd).size;
}

function rotateLog() {
  if (outputFd !== undefined) closeSync(outputFd);
  try { unlinkSync(rotatedOutputPath); } catch {}
  try { renameSync(outputPath, rotatedOutputPath); } catch {}
  outputFd = openSync(outputPath, "w");
  outputBytes = 0;
}

function appendLog(chunk) {
  let buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  if (buffer.length >= maxOutputBytes) {
    rotateLog();
    buffer = buffer.subarray(buffer.length - maxOutputBytes);
  } else if (outputBytes + buffer.length > maxOutputBytes) {
    rotateLog();
  }
  writeSync(outputFd, buffer);
  outputBytes += buffer.length;
}

function killChild(signal) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])], {
        detached: true,
        stdio: "ignore",
      });
      killer.unref();
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {}
}

async function requestStop(reason) {
  if (stopRequested) return;
  stopRequested = true;
  timedOut = reason === "timeout";
  await save({ status: "stopping", error: timedOut ? "Job exceeded its timeout." : state.error });
  killChild("SIGTERM");
  if (timedOut) forceTimer = setTimeout(() => killChild("SIGKILL"), 2_000);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { void requestStop("signal"); });
}

process.on("uncaughtException", async (error) => {
  try {
    await save({
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    });
  } finally {
    process.exit(1);
  }
});

try {
  openLog();
  const environment = { ...process.env, ...(spec.environment ?? {}), PI_BACKGROUND_JOB_ID: spec.id };
  const spawnOptions = {
    cwd: spec.cwd,
    env: environment,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  };

  if (spec.launch.kind === "exec") {
    child = spawn(spec.launch.executable, spec.launch.args ?? [], spawnOptions);
  } else if (process.platform === "win32") {
    child = spawn(process.env.COMSPEC || "cmd.exe", ["/d", "/s", "/c", spec.launch.command], spawnOptions);
  } else {
    child = spawn(process.env.PI_BACKGROUND_JOB_SHELL || "/bin/bash", ["-lc", spec.launch.command], spawnOptions);
  }

  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);

  let timeoutTimer;
  let finalizing = false;
  const runningSaved = save({
    status: "running",
    supervisorPid: process.pid,
    processPid: child.pid,
    startedAt: new Date().toISOString(),
  });

  child.on("error", async (error) => {
    if (finalizing) return;
    finalizing = true;
    await runningSaved;
    await save({
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    if (outputFd !== undefined) closeSync(outputFd);
    process.exit(1);
  });

  child.on("close", async (code, signal) => {
    if (finalizing) return;
    finalizing = true;
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (forceTimer) clearTimeout(forceTimer);
    await runningSaved;
    const status = timedOut ? "timed_out" : stopRequested || existsSync(controlPath) ? "stopped" : code === 0 ? "completed" : "failed";
    await save({
      status,
      finishedAt: new Date().toISOString(),
      exitCode: code,
      signal,
    });
    if (outputFd !== undefined) closeSync(outputFd);
    process.exit(status === "completed" || status === "stopped" ? 0 : 1);
  });

  await runningSaved;
  if (spec.timeoutSeconds && !finalizing) {
    timeoutTimer = setTimeout(() => { void requestStop("timeout"); }, spec.timeoutSeconds * 1_000);
  }
} catch (error) {
  await save({
    status: "failed",
    supervisorPid: process.pid,
    finishedAt: new Date().toISOString(),
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  });
  if (outputFd !== undefined) closeSync(outputFd);
  process.exit(1);
}
