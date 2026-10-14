import assert from "node:assert/strict";
import test from "node:test";
import {
  formatNotification,
  MAX_FAILURE_WAKES,
  NOTIFICATION_TYPE,
  planDelivery,
  REPORTED_TYPE,
  reportedJobIds,
  unreportedTerminalJobs,
} from "./notifications.ts";
import type { JobStatus, ManagedJob } from "./runtime.ts";

function job(id: string, status: JobStatus, extra: { notify?: boolean; exitCode?: number; createdAt?: string } = {}): ManagedJob {
  const createdAt = extra.createdAt ?? "2026-09-22T12:00:00.000Z";
  return {
    spec: { version: 1, id, title: `title ${id}`, launch: { kind: "shell", command: "true" }, cwd: "/tmp", createdAt, notify: extra.notify },
    state: { version: 1, id, status, createdAt, updatedAt: createdAt, exitCode: extra.exitCode },
    dir: `/jobs/${id}`,
    outputPath: `/jobs/${id}/output.log`,
  };
}

test("successful jobs always wake the agent", () => {
  assert.equal(planDelivery(job("job-a", "completed"), 0), "wake");
  assert.equal(planDelivery(job("job-a", "completed"), MAX_FAILURE_WAKES + 5), "wake");
});

test("failures wake the agent until the consecutive failure budget is spent", () => {
  for (const status of ["failed", "timed_out", "orphaned"] as const) {
    assert.equal(planDelivery(job("job-f", status), MAX_FAILURE_WAKES - 1), "wake");
    assert.equal(planDelivery(job("job-f", status), MAX_FAILURE_WAKES), "next-turn");
  }
});

test("stopped jobs and notify=false jobs never wake the agent", () => {
  assert.equal(planDelivery(job("job-s", "stopped"), 0), "next-turn");
  assert.equal(planDelivery(job("job-n", "completed", { notify: false }), 0), "next-turn");
  assert.equal(planDelivery(job("job-n", "failed", { notify: false }), 0), "next-turn");
});

test("notification includes status, exit code, output tail, and failure guidance", () => {
  const output = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
  const text = formatNotification(job("job-x", "failed", { exitCode: 2 }), output, { delivery: "wake" });
  assert.match(text, /Background job job-x failed exit=2: title job-x/);
  assert.match(text, /line 99/);
  assert.doesNotMatch(text, /line 59\n/);
  assert.match(text, /classify the failure/);
  assert.match(text, /not a new user instruction/);
});

test("notification tells the agent to stop after the failure limit", () => {
  const text = formatNotification(job("job-x", "failed"), "", { delivery: "next-turn", failureLimitReached: true });
  assert.match(text, /Automatic follow-up stopped/);
  assert.match(text, /\(no output\)/);
});

test("recovered notifications say the job finished while Pi was closed", () => {
  const text = formatNotification(job("job-r", "completed"), "done", { delivery: "next-turn", recovered: true });
  assert.match(text, /finished while Pi was not running/);
});

test("reportedJobIds reads legacy entries, custom messages, and inline markers", () => {
  const ids = reportedJobIds([
    { type: "custom", customType: NOTIFICATION_TYPE, data: { id: "job-legacy" } },
    { type: "custom_message", customType: NOTIFICATION_TYPE, details: { id: "job-message" } },
    { type: "custom", customType: REPORTED_TYPE, data: { id: "job-inline" } },
    { type: "custom", customType: "other", data: { id: "job-other" } },
    { type: "message" },
  ]);
  assert.deepEqual([...ids].sort(), ["job-inline", "job-legacy", "job-message"]);
});

test("unreportedTerminalJobs skips running and already reported jobs, oldest first", () => {
  const jobs = [
    job("job-new", "failed", { createdAt: "2026-09-22T13:00:00.000Z" }),
    job("job-running", "running"),
    job("job-seen", "completed"),
    job("job-old", "completed", { createdAt: "2026-09-22T11:00:00.000Z" }),
  ];
  const missed = unreportedTerminalJobs(jobs, new Set(["job-seen"]));
  assert.deepEqual(missed.map((j) => j.spec.id), ["job-old", "job-new"]);
});
