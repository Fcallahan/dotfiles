import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { describeBackgroundTasks, formatTaskDuration, scanBackgroundTasks, slugifyCwd } from "./background-tasks.ts";

function jsonl(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

test("slugifyCwd replaces every non-alphanumeric character with a single dash", () => {
  assert.equal(
    slugifyCwd("/home/franciscallahan/code/Work/EMSmart2.0-Client-Application/TestWorkTree"),
    "-home-franciscallahan-code-Work-EMSmart2-0-Client-Application-TestWorkTree",
  );
});

test("formatTaskDuration renders seconds, minutes, and hours", () => {
  assert.equal(formatTaskDuration(0), "0s");
  assert.equal(formatTaskDuration(45_000), "45s");
  assert.equal(formatTaskDuration(125_000), "2m5s");
  assert.equal(formatTaskDuration(3_725_000), "1h2m");
});

test("scanBackgroundTasks returns [] when there is no session id", () => {
  assert.deepEqual(scanBackgroundTasks({ cwd: "/tmp/whatever" }), []);
});

test("scanBackgroundTasks returns [] when the tasks directory does not exist", () => {
  assert.deepEqual(
    scanBackgroundTasks({ cwd: "/tmp/whatever", sessionId: "no-such-session", tmpRootOverride: "/tmp/pi-bg-tasks-missing" }),
    [],
  );
});

test("scanBackgroundTasks parses a task transcript and marks recently-modified files active", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "pi-bg-tasks-"));
  try {
    const cwd = "/home/example/project";
    const sessionId = "session-123";
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    const dir = join(tmpRoot, `claude-${uid}`, slugifyCwd(cwd), sessionId, "tasks");
    await mkdir(dir, { recursive: true });

    const started = new Date(Date.now() - 60_000).toISOString();
    const content = jsonl([
      {
        type: "user",
        agentId: "task-abc",
        timestamp: started,
        message: { role: "user", content: "Explore the repo and report back." },
      },
      {
        type: "assistant",
        agentId: "task-abc",
        attributionAgent: "Explore",
        timestamp: new Date().toISOString(),
        message: { role: "assistant", content: [{ type: "text", text: "..." }] },
      },
    ]);
    const outputPath = join(dir, "task-abc.output");
    await writeFile(outputPath, content, "utf8");
    const now = new Date();
    await utimes(outputPath, now, now);

    const tasks = scanBackgroundTasks({ cwd, sessionId, tmpRootOverride: tmpRoot });
    assert.equal(tasks.length, 1);
    const task = tasks[0]!;
    assert.equal(task.id, "task-abc");
    assert.equal(task.label, "Explore");
    assert.equal(task.taskPreview, "Explore the repo and report back.");
    assert.equal(task.active, true);
    assert.ok(task.startedAt !== undefined && task.startedAt <= Date.now());

    const description = describeBackgroundTasks(tasks);
    assert.match(description ?? "", /Explore/);
    assert.match(description ?? "", /1 claude bg task/);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("scanBackgroundTasks marks stale files inactive and describeBackgroundTasks hides them", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "pi-bg-tasks-"));
  try {
    const cwd = "/home/example/project";
    const sessionId = "session-456";
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    const dir = join(tmpRoot, `claude-${uid}`, slugifyCwd(cwd), sessionId, "tasks");
    await mkdir(dir, { recursive: true });

    const content = jsonl([
      { type: "user", agentId: "task-old", timestamp: new Date(Date.now() - 120_000).toISOString(), message: { role: "user", content: "Old task." } },
      { type: "assistant", agentId: "task-old", attributionAgent: "coder", timestamp: new Date(Date.now() - 60_000).toISOString(), message: { role: "assistant", content: [] } },
    ]);
    const outputPath = join(dir, "task-old.output");
    await writeFile(outputPath, content, "utf8");
    const oldTime = new Date(Date.now() - 60_000);
    await utimes(outputPath, oldTime, oldTime);

    const tasks = scanBackgroundTasks({ cwd, sessionId, tmpRootOverride: tmpRoot, staleMs: 20_000 });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]!.active, false);
    assert.equal(describeBackgroundTasks(tasks), undefined);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("scanBackgroundTasks ignores empty files and non-.output entries", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "pi-bg-tasks-"));
  try {
    const cwd = "/home/example/project";
    const sessionId = "session-789";
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    const dir = join(tmpRoot, `claude-${uid}`, slugifyCwd(cwd), sessionId, "tasks");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "empty.output"), "", "utf8");
    await writeFile(join(dir, "notes.txt"), "not a task", "utf8");

    const tasks = scanBackgroundTasks({ cwd, sessionId, tmpRootOverride: tmpRoot });
    assert.deepEqual(tasks, []);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
