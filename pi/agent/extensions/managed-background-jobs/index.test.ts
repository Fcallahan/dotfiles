// Extension-level tests: load index.ts against a fake Pi API and verify that finished
// background jobs reach the model (and wake it) without any user input.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";

// Pi provides these packages at runtime; resolve them from the installed Pi for tests.
const PI_ROOT = process.env.PI_CODING_AGENT_ROOT ?? "/usr/lib/node_modules/@earendil-works/pi-coding-agent";
const skip = existsSync(join(PI_ROOT, "package.json")) ? false : `Pi install not found at ${PI_ROOT}`;
if (!skip) {
  const parent = JSON.stringify(pathToFileURL(join(PI_ROOT, "package.json")).href);
  register(`data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      try { return await next(specifier, context); } catch (error) {
        if (specifier.startsWith("@earendil-works/pi-coding-agent") || specifier.startsWith("@earendil-works/pi-tui")) {
          return next(specifier, { ...context, parentURL: ${parent} });
        }
        throw error;
      }
    }`)}`);
}

type Sent = { message: any; options: any };
let agentDir: string;
let startJob: typeof import("./runtime.ts").startManagedJob;

function createHarness(sessionId: string) {
  const handlers = new Map<string, Array<(...args: any[]) => any>>();
  const tools = new Map<string, any>();
  const sent: Sent[] = [];
  const entries: any[] = [];
  const pi = {
    on: (name: string, handler: (...args: any[]) => any) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: () => {},
    registerEntryRenderer: () => {},
    registerMessageRenderer: () => {},
    getActiveTools: () => [],
    setActiveTools: () => {},
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
    sendMessage: (message: any, options: any) => {
      sent.push({ message, options });
      entries.push({ type: "custom_message", customType: message.customType, details: message.details });
    },
  };
  const ctx = {
    hasUI: false,
    mode: "rpc",
    cwd: agentDir,
    sessionManager: { getSessionId: () => sessionId, getEntries: () => entries },
  };
  const emit = async (name: string, event: unknown = {}) => {
    for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
  };
  const run = (toolName: string, params: Record<string, unknown>) =>
    tools.get(toolName).execute("call", params, undefined, undefined, ctx);
  return { pi, ctx, sent, entries, emit, run };
}

async function loadExtension(sessionId: string) {
  const harness = createHarness(sessionId);
  const { default: extension } = await import("./index.ts");
  extension(harness.pi as any);
  await harness.emit("session_start");
  return harness;
}

async function waitFor<T>(check: () => T | undefined, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for condition.");
}

before(async () => {
  agentDir = await mkdtemp(join(tmpdir(), "pi-bg-ext-test-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  ({ startManagedJob: startJob } = await import("./runtime.ts"));
});

after(async () => {
  await rm(agentDir, { recursive: true, force: true });
});

test("a finished background job wakes the agent with its output", { skip }, async () => {
  const h = await loadExtension("session-wake");
  try {
    await h.run("managed_bash", { command: "echo build-ok", title: "build" });
    const note = await waitFor(() => h.sent.find((s) => s.message.details.status === "completed"));
    assert.deepEqual(note.options, { triggerTurn: true, deliverAs: "steer" });
    assert.match(note.message.content, /build-ok/);
    assert.equal(note.message.details.delivery, "wake");
  } finally {
    await h.emit("session_shutdown");
  }
});

test("notify=false records the result without starting a turn", { skip }, async () => {
  const h = await loadExtension("session-quiet");
  try {
    await h.run("managed_bash", { command: "true", title: "watcher", notify: false });
    const note = await waitFor(() => h.sent[0]);
    assert.deepEqual(note.options, { triggerTurn: false });
  } finally {
    await h.emit("session_shutdown");
  }
});

test("foreground jobs and waited jobs are not reported twice", { skip }, async () => {
  const h = await loadExtension("session-inline");
  try {
    await h.run("managed_bash", { command: "echo fg", run_in_background: false });
    const started = await h.run("managed_bash", { command: "sleep 0.5; echo waited" });
    const waited = await h.run("background_jobs", { action: "wait", id: started.details.id, timeout_seconds: 10 });
    assert.match(waited.content[0].text, /waited/);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    assert.equal(h.sent.length, 0);
    assert.equal(h.entries.filter((e) => e.customType === "background-job-reported").length, 2);
  } finally {
    await h.emit("session_shutdown");
  }
});

test("a foreground job promoted with Ctrl+B is still reported when it finishes", { skip }, async () => {
  const h = await loadExtension("session-promote");
  const { promoteForegroundJobs } = await import("./runtime.ts");
  try {
    const running = h.run("managed_bash", { command: "sleep 1; echo promoted-done", run_in_background: false });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(promoteForegroundJobs().length, 1);
    const result = await running;
    assert.match(result.content[0].text, /Moved foreground job to the background/);
    const note = await waitFor(() => h.sent.find((s) => s.message.details.status === "completed"));
    assert.equal(note.message.details.delivery, "wake");
    assert.match(note.message.content, /promoted-done/);
  } finally {
    await h.emit("session_shutdown");
  }
});

test("repeated failures stop waking the agent until the user types", { skip }, async () => {
  const h = await loadExtension("session-failures");
  try {
    for (let i = 0; i < 4; i += 1) {
      await h.run("managed_bash", { command: "exit 1", title: `fail ${i}` });
      await waitFor(() => (h.sent.length === i + 1 ? true : undefined));
    }
    assert.deepEqual(h.sent.map((s) => s.message.details.delivery), ["wake", "wake", "wake", "next-turn"]);
    assert.match(h.sent[3].message.content, /Automatic follow-up stopped/);

    await h.emit("input", { source: "extension", text: "injected" });
    await h.run("managed_bash", { command: "exit 1", title: "fail after injected input" });
    assert.equal((await waitFor(() => h.sent[4])).message.details.delivery, "next-turn");

    await h.emit("input", { source: "interactive", text: "try again" });
    await h.run("managed_bash", { command: "exit 1", title: "fail after input" });
    assert.equal((await waitFor(() => h.sent[5])).message.details.delivery, "wake");

    // A success in between also resets the budget.
    await h.run("managed_bash", { command: "exit 1", title: "fail 2" });
    await waitFor(() => (h.sent.length === 7 ? true : undefined));
    await h.run("managed_bash", { command: "true", title: "ok" });
    await waitFor(() => (h.sent.length === 8 ? true : undefined));
    for (let i = 0; i < 3; i += 1) {
      await h.run("managed_bash", { command: "exit 1", title: `fail after success ${i}` });
      await waitFor(() => (h.sent.length === 9 + i ? true : undefined));
    }
    assert.deepEqual(h.sent.slice(8).map((s) => s.message.details.delivery), ["wake", "wake", "wake"]);
  } finally {
    await h.emit("session_shutdown");
  }
});

test("jobs that finished while Pi was closed are reported once on resume", { skip }, async () => {
  const sessionId = "session-resume";
  const job = await startJob({ launch: { kind: "shell", command: "echo offline" }, cwd: agentDir, sessionId });
  const { getManagedJob } = await import("./runtime.ts");
  const deadline = Date.now() + 5_000;
  while ((await getManagedJob(job.spec.id)).state.status !== "completed" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const h = await loadExtension(sessionId);
  try {
    assert.equal(h.sent.length, 1);
    assert.deepEqual(h.sent[0].options, { triggerTurn: false });
    assert.equal(h.sent[0].message.details.recovered, true);
    assert.match(h.sent[0].message.content, /offline/);

    // A later reload of the same session must not replay it.
    await h.emit("session_start");
    assert.equal(h.sent.length, 1);
  } finally {
    await h.emit("session_shutdown");
  }
});
