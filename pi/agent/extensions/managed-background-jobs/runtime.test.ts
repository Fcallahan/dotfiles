import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getManagedJob,
  promoteForegroundJobs,
  readJobOutput,
  registerForegroundJob,
  restartManagedJob,
  startManagedJob,
  stopManagedJob,
} from "./runtime.ts";

async function waitForTerminal(id: string, rootDir: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await getManagedJob(id, rootDir);
    if (["completed", "failed", "stopped", "timed_out", "orphaned"].includes(job.state.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Job ${id} did not settle.`);
}

test("runs a detached command and preserves its output", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "pi-bg-test-"));
  try {
    const started = await startManagedJob({
      launch: { kind: "shell", command: "printf 'hello from background\\n'" },
      cwd: rootDir,
      rootDir,
    });
    const finished = await waitForTerminal(started.spec.id, rootDir);
    assert.equal(finished.state.status, "completed");
    assert.equal(finished.state.exitCode, 0);
    assert.match(await readJobOutput(finished), /hello from background/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("stops the managed process group gracefully", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "pi-bg-test-"));
  try {
    const started = await startManagedJob({
      launch: { kind: "shell", command: "sleep 30" },
      cwd: rootDir,
      rootDir,
    });
    const stopped = await stopManagedJob(started.spec.id, { graceSeconds: 3, force: true, rootDir });
    assert.equal(stopped.state.status, "stopped");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("honors a non-forced graceful stop window", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "pi-bg-test-"));
  try {
    const started = await startManagedJob({
      launch: { kind: "shell", command: "trap '' TERM; while true; do sleep 1; done" },
      cwd: rootDir,
      rootDir,
    });
    const began = Date.now();
    const stillRunning = await stopManagedJob(started.spec.id, { graceSeconds: 1, force: false, rootDir });
    assert.ok(Date.now() - began >= 900);
    assert.ok(["running", "stopping"].includes(stillRunning.state.status));
    const stopped = await stopManagedJob(started.spec.id, { graceSeconds: 0, force: true, rootDir });
    assert.equal(stopped.state.status, "stopped");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("fails cleanly when the working directory is missing", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "pi-bg-test-"));
  try {
    await assert.rejects(
      startManagedJob({
        launch: { kind: "shell", command: "echo unreachable" },
        cwd: join(rootDir, "missing"),
        rootDir,
      }),
      /cwd is not a directory/,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("rotates output instead of growing without a bound", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "pi-bg-test-"));
  const previousLimit = process.env.PI_BACKGROUND_JOB_MAX_BYTES;
  process.env.PI_BACKGROUND_JOB_MAX_BYTES = String(1024 * 1024);
  try {
    const started = await startManagedJob({
      launch: { kind: "shell", command: `${process.execPath} -e "process.stdout.write('x'.repeat(1200000))"` },
      cwd: rootDir,
      rootDir,
    });
    const finished = await waitForTerminal(started.spec.id, rootDir);
    assert.equal(finished.state.status, "completed");
    assert.ok((await stat(finished.outputPath)).size <= 1024 * 1024);
    assert.ok((await stat(`${finished.outputPath}.1`)).size <= 1024 * 1024);
    assert.match(await readJobOutput(finished, 2 * 1024 * 1024), /log rotated/);
  } finally {
    if (previousLimit === undefined) delete process.env.PI_BACKGROUND_JOB_MAX_BYTES;
    else process.env.PI_BACKGROUND_JOB_MAX_BYTES = previousLimit;
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("restart creates a new job owned by the requesting session", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "pi-bg-test-"));
  try {
    const first = await startManagedJob({
      launch: { kind: "shell", command: "sleep 30" },
      cwd: rootDir,
      rootDir,
      sessionId: "old-session",
    });
    const restarted = await restartManagedJob(first.spec.id, {
      graceSeconds: 1,
      force: true,
      sessionId: "new-session",
      rootDir,
    });
    assert.notEqual(restarted.spec.id, first.spec.id);
    assert.equal(restarted.spec.sessionId, "new-session");
    await stopManagedJob(restarted.spec.id, { graceSeconds: 1, force: true, rootDir });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("promotes only active foreground managed jobs", async () => {
  const first = registerForegroundJob("job-first");
  const second = registerForegroundJob("job-second");
  assert.deepEqual(promoteForegroundJobs().sort(), ["job-first", "job-second"]);
  await Promise.all([first.promoted, second.promoted]);
  assert.deepEqual(promoteForegroundJobs(), []);
  first.dispose();
  second.dispose();
});
