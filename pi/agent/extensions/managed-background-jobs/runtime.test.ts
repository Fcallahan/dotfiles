import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  formatDuration,
  formatJob,
  getManagedJob,
  jobElapsedMs,
  promoteForegroundJobs,
  readJobOutput,
  registerForegroundJob,
  restartManagedJob,
  startManagedJob,
  stopManagedJob,
  waitForManagedJob,
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

test("formatDuration renders seconds, minutes, and hours", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(45_000), "45s");
  assert.equal(formatDuration(125_000), "2m5s");
  assert.equal(formatDuration(3_725_000), "1h2m");
});

test("jobElapsedMs and formatJob report elapsed time for running and finished jobs", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "pi-bg-test-"));
  try {
    const started = await startManagedJob({
      launch: { kind: "shell", command: "sleep 1" },
      cwd: rootDir,
      rootDir,
    });
    const running = await getManagedJob(started.spec.id, rootDir);
    if (running.state.status === "running" || running.state.status === "starting") {
      const runningElapsed = jobElapsedMs(running);
      assert.ok(runningElapsed !== undefined && runningElapsed >= 0);
      assert.match(formatJob(running), /elapsed=\d+s/);
    }

    const finished = await waitForTerminal(started.spec.id, rootDir);
    const finishedElapsed = jobElapsedMs(finished, Date.now() + 60_000);
    assert.ok(finishedElapsed !== undefined && finishedElapsed >= 0);
    // Terminal jobs report a fixed "ran" duration that ignores the `now` passed in.
    assert.equal(jobElapsedMs(finished), finishedElapsed);
    assert.match(formatJob(finished), /ran=\d+s/);
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

test("waitForManagedJob returns the terminal job or the running job at timeout", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "pi-bg-test-"));
  try {
    const quick = await startManagedJob({ launch: { kind: "shell", command: "sleep 0.3" }, cwd: rootDir, rootDir });
    const done = await waitForManagedJob(quick.spec.id, { timeoutMs: 5_000, rootDir, pollMs: 50 });
    assert.equal(done.state.status, "completed");

    const slow = await startManagedJob({ launch: { kind: "shell", command: "sleep 30" }, cwd: rootDir, rootDir });
    const began = Date.now();
    const pending = await waitForManagedJob(slow.spec.id, { timeoutMs: 300, rootDir, pollMs: 50 });
    assert.ok(Date.now() - began < 2_000);
    assert.equal(pending.state.status, "running");

    const controller = new AbortController();
    controller.abort();
    const aborted = await waitForManagedJob(slow.spec.id, { timeoutMs: 5_000, rootDir, signal: controller.signal });
    assert.equal(aborted.state.status, "running");
    await stopManagedJob(slow.spec.id, { graceSeconds: 1, force: true, rootDir });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("notify=false is stored on the job and preserved by restart", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "pi-bg-test-"));
  try {
    const first = await startManagedJob({ launch: { kind: "shell", command: "sleep 30" }, cwd: rootDir, rootDir, notify: false });
    assert.equal(first.spec.notify, false);
    const restarted = await restartManagedJob(first.spec.id, { graceSeconds: 1, force: true, rootDir });
    assert.equal(restarted.spec.notify, false);
    await stopManagedJob(restarted.spec.id, { graceSeconds: 1, force: true, rootDir });

    const defaulted = await startManagedJob({ launch: { kind: "shell", command: "true" }, cwd: rootDir, rootDir });
    assert.equal(defaulted.spec.notify, undefined);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("a command that exits non-zero quickly is a failed job, not a startup error", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "pi-bg-test-"));
  try {
    const started = await startManagedJob({ launch: { kind: "shell", command: "exit 3" }, cwd: rootDir, rootDir });
    const finished = await waitForTerminal(started.spec.id, rootDir);
    assert.equal(finished.state.status, "failed");
    assert.equal(finished.state.exitCode, 3);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
