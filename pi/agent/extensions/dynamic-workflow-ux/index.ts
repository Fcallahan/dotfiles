import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const TOOL_NAME = "run_dynamic_workflow";
const MAX_TAIL = 20_000;
const UPDATE_MS = 500;
const MAX_CONCURRENCY = 32;

type UnitStatus = "pending" | "running" | "done" | "failed" | string;

type UnitEntry = {
  key?: string;
  index?: number;
  label?: string;
  status?: UnitStatus;
  attempts?: number;
  artifact?: string;
  error?: string;
};

type Manifest = {
  invocationId?: string;
  name?: string;
  task?: string;
  runDir?: string;
  updatedAt?: string;
  counts?: Record<string, number>;
  units?: Record<string, UnitEntry>;
};

type ManifestView = {
  path: string;
  name: string;
  task?: string;
  counts: Record<string, number>;
  units: UnitEntry[];
};

type Snapshot = {
  script: string;
  cwd: string;
  state: "running" | "completed" | "failed" | "cancelled";
  code?: number | null;
  signal?: string | null;
  durationMs?: number;
  command: string[];
  manifests: ManifestView[];
  stdout: string;
  stderr: string;
};

const schema = Type.Object({
  script: Type.String({ description: "Path to a Node ESM workflow script, usually .pi/workflows/<slug>.mjs or ~/.pi/agent/workflows/saved/<name>.mjs." }),
  args: Type.Optional(Type.Array(Type.String(), { description: "Positional workflow units/arguments after standard flags." })),
  cwd: Type.Optional(Type.String({ description: "Working directory for the workflow. Defaults to the current project cwd." })),
  concurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_CONCURRENCY, description: `Passed as --concurrency <n> (maximum ${MAX_CONCURRENCY}).` })),
  retries: Type.Optional(Type.Number({ description: "Passed as --retries <n>." })),
  force: Type.Optional(Type.Boolean({ description: "Pass --force to ignore previous artifacts." })),
  noResume: Type.Optional(Type.Boolean({ description: "Pass --no-resume to rerun this invocation without reusing done units." })),
});

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: TOOL_NAME,
    label: "Dynamic Workflow",
    description: "Run one of our manifest-based Node dynamic workflows with live compact progress from .pi/workflows/runs manifests.",
    promptSnippet: "Run our manifest-based dynamic workflow scripts with live progress and resumable artifact reporting.",
    promptGuidelines: [
      "Use run_dynamic_workflow instead of bash `node ...` when running our dynamic workflow scripts from `.pi/workflows/*.mjs` or `~/.pi/agent/workflows/saved/*.mjs`.",
      "For run_dynamic_workflow, pass workflow unit paths/items in `args`; use `concurrency`, `retries`, `force`, and `noResume` instead of manually spelling those flags.",
      "Do not use run_dynamic_workflow for arbitrary shell commands; it only runs Node workflow scripts and streams manifest progress.",
    ],
    parameters: schema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const started = Date.now();
      const cwd = path.resolve(ctx.cwd, params.cwd ?? ".");
      const script = resolveWorkflowScript(cwd, params.script);
      const invocationId = `${process.pid}-${started}-${Math.random().toString(36).slice(2)}`;
      const args = buildNodeArgs(script, params);
      let stdout = "";
      let stderr = "";
      let child: ReturnType<typeof spawn> | undefined;
      let state: Snapshot["state"] = "running";
      let cancelled = false;
      let settled = false;
      let killTimer: NodeJS.Timeout | undefined;
      let lastEmit = 0;

      const snapshot = (): Snapshot => ({
        script,
        cwd,
        state,
        command: ["node", ...args],
        manifests: loadInvocationManifests(cwd, invocationId),
        stdout: tail(stdout),
        stderr: tail(stderr),
      });

      const emit = (force = false) => {
        const now = Date.now();
        if (!force && now - lastEmit < UPDATE_MS) return;
        lastEmit = now;
        const snap = snapshot();
        onUpdate?.({ content: [{ type: "text", text: renderSnapshot(snap) }], details: snap });
      };

      try {
        child = spawn("node", args, {
          cwd,
          env: { ...process.env, PI_DYNAMIC_WORKFLOW_RUN_ID: invocationId },
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        state = "failed";
        throw error;
      }

      const abort = () => {
        if (settled) return;
        cancelled = true;
        state = "cancelled";
        killTimer = killProcessTree(child);
        emit(true);
      };

      const timer = setInterval(() => emit(), UPDATE_MS);
      child.stdout.on("data", (chunk) => { stdout = tail(stdout + String(chunk)); emit(); });
      child.stderr.on("data", (chunk) => { stderr = tail(stderr + String(chunk)); emit(); });

      const completion = new Promise<{ code: number | null; sig: NodeJS.Signals | null }>((resolve) => {
        (child as any).on("error", (error: unknown) => {
          stderr = tail(`${stderr}\n${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        });
        (child as any).on("close", (code: number | null, sig: NodeJS.Signals | null) => {
          settled = true;
          if (killTimer) clearTimeout(killTimer);
          resolve({ code, sig });
        });
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const { code, sig } = await completion;

      clearInterval(timer);
      signal?.removeEventListener("abort", abort);
      if (!cancelled) state = code === 0 ? "completed" : "failed";

      const finalSnap: Snapshot = { ...snapshot(), code, signal: sig, durationMs: Date.now() - started };
      onUpdate?.({ content: [{ type: "text", text: renderSnapshot(finalSnap) }], details: finalSnap });

      if (cancelled) throw new Error("Dynamic workflow cancelled");
      if (code !== 0) {
        throw new Error(`Dynamic workflow failed with exit code ${code ?? sig ?? "unknown"}\n${sanitize(tail(stderr, 4000))}`);
      }
      return { content: [{ type: "text", text: renderSnapshot(finalSnap) }], details: finalSnap };
    },
    renderCall(args, theme) {
      const script = typeof args?.script === "string" ? shorten(path.basename(args.script), 80) : "workflow";
      return new Text(`${theme.fg("toolTitle", theme.bold("dynamic workflow"))} ${theme.fg("muted", script)}`, 0, 0);
    },
    renderResult(result, { isPartial }, theme) {
      const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
      if (isPartial) return new Text(theme.fg("warning", text || "Dynamic workflow running..."), 0, 0);
      return new Text(text, 0, 0);
    },
  });

  pi.on("session_start", () => {
    const active = pi.getActiveTools();
    if (!active.includes(TOOL_NAME)) pi.setActiveTools([...active, TOOL_NAME]);
  });
}

function resolveWorkflowScript(cwd: string, input: string): string {
  const expanded = input.startsWith("~/") ? path.join(process.env.HOME ?? "", input.slice(2)) : input;
  const resolved = path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
  if (!fs.existsSync(resolved)) throw new Error(`Workflow script not found: ${resolved}`);
  if (!fs.statSync(resolved).isFile()) throw new Error(`Workflow script is not a file: ${resolved}`);
  if (!/\.mjs$/i.test(resolved)) throw new Error(`Workflow script must be a .mjs file: ${resolved}`);
  const real = fs.realpathSync(resolved);
  const roots = [
    path.resolve(cwd, ".pi", "workflows"),
    path.join(process.env.HOME ?? "", ".pi", "agent", "workflows", "saved"),
  ].filter((root) => fs.existsSync(root)).map((root) => fs.realpathSync(root));
  if (!roots.some((root) => isWithin(root, real))) {
    throw new Error(`Workflow script must be under ${path.join(cwd, ".pi", "workflows")} or ~/.pi/agent/workflows/saved: ${real}`);
  }
  return real;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function buildNodeArgs(script: string, params: any): string[] {
  const args = [script];
  if (params.force) args.push("--force");
  if (params.noResume) args.push("--no-resume");
  if (params.retries !== undefined) args.push("--retries", String(Math.max(0, Math.floor(Number(params.retries)))));
  if (params.concurrency !== undefined) args.push("--concurrency", String(Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(Number(params.concurrency))))));
  for (const arg of params.args ?? []) args.push(String(arg));
  return args;
}

function loadInvocationManifests(cwd: string, invocationId: string): ManifestView[] {
  const root = path.join(cwd, ".pi", "workflows", "runs");
  if (!fs.existsSync(root)) return [];
  const out: ManifestView[] = [];
  for (const dirent of safeReaddir(root)) {
    if (!dirent.isDirectory()) continue;
    const manifestPath = path.join(root, dirent.name, "manifest.json");
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
      if (manifest.invocationId !== invocationId) continue;
      const units = Object.values(manifest.units ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      out.push({
        path: manifestPath,
        name: manifest.name || dirent.name,
        task: manifest.task,
        counts: manifest.counts ?? countUnits(units),
        units,
      });
    } catch {
      // Ignore half-written or unrelated files while the workflow is updating manifests.
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function safeReaddir(dir: string): fs.Dirent[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }
}

function countUnits(units: UnitEntry[]): Record<string, number> {
  const counts: Record<string, number> = { total: units.length, done: 0, failed: 0, pending: 0, running: 0 };
  for (const unit of units) counts[unit.status || "pending"] = (counts[unit.status || "pending"] ?? 0) + 1;
  return counts;
}

function renderSnapshot(snap: Snapshot): string {
  const total = snap.manifests.reduce((n, m) => n + (m.counts.total ?? m.units.length), 0);
  const done = snap.manifests.reduce((n, m) => n + (m.counts.done ?? 0), 0);
  const running = snap.manifests.reduce((n, m) => n + (m.counts.running ?? 0), 0);
  const failed = snap.manifests.reduce((n, m) => n + (m.counts.failed ?? 0), 0);
  const state = snap.durationMs === undefined ? snap.state : `${snap.state} in ${formatDuration(snap.durationMs)}`;
  const parts = [`◆ Dynamic workflow: ${path.basename(snap.script)} (${done}/${total || "?"} done${running ? `, ${running} running` : ""}${failed ? `, ${failed} failed` : ""})`, `  ${state}`];

  for (const manifest of snap.manifests) {
    const c = manifest.counts;
    parts.push(`  ${phaseIcon(c)} ${manifest.name} ${c.done ?? 0}/${c.total ?? manifest.units.length}${c.running ? ` · ${c.running} running` : ""}${c.failed ? ` · ${c.failed} failed` : ""}`);
    for (const unit of visibleUnits(manifest.units)) {
      const num = unit.index == null ? "" : `#${unit.index + 1} `;
      const attempts = unit.attempts ? ` (${unit.attempts}x)` : "";
      parts.push(`    ${num}${statusIcon(unit.status)} ${shorten(unit.label || unit.key || "unit", 72)}${attempts}`);
      if (unit.status === "failed" && unit.error) parts.push(`      ${shorten(unit.error.split("\n")[0] || "failed", 96)}`);
    }
    if (manifest.units.length > visibleUnits(manifest.units).length) parts.push(`    … ${manifest.units.length - visibleUnits(manifest.units).length} more unit(s)`);
    parts.push(`    manifest: ${manifest.path}`);
  }

  if (!snap.manifests.length) parts.push("  waiting for workflow manifests...");
  if (snap.stdout.trim()) parts.push("", "  stdout:", ...indentLines(lastLines(snap.stdout, 6), "    "));
  if (snap.stderr.trim()) parts.push("", "  stderr:", ...indentLines(lastLines(snap.stderr, 6), "    "));
  return sanitize(parts.join("\n"));
}

function visibleUnits(units: UnitEntry[]): UnitEntry[] {
  const important = units.filter((u) => u.status === "running" || u.status === "failed");
  const rest = units.filter((u) => u.status !== "running" && u.status !== "failed");
  return [...important, ...rest].slice(0, 5);
}

function phaseIcon(counts: Record<string, number>): string {
  if (counts.running) return "▶";
  if (counts.failed) return "✗";
  if ((counts.done ?? 0) >= (counts.total ?? 0)) return "✓";
  return "○";
}

function statusIcon(status: UnitStatus | undefined): string {
  if (status === "done") return "✓";
  if (status === "failed") return "✗";
  if (status === "running") return "●";
  return "○";
}

function killProcessTree(child?: ReturnType<typeof spawn>): NodeJS.Timeout | undefined {
  if (!child?.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {}
  const timer = setTimeout(() => {
    try {
      if (process.platform !== "win32") process.kill(-child!.pid!, "SIGKILL");
      else child!.kill("SIGKILL");
    } catch {}
  }, 2_000).unref?.();
  return timer;
}

function tail(text: string, max = MAX_TAIL): string {
  return text.length > max ? text.slice(text.length - max) : text;
}

function lastLines(text: string, count: number): string[] {
  const lines = text.trimEnd().split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - count));
}

function indentLines(lines: string[], prefix: string): string[] {
  return lines.map((line) => `${prefix}${shorten(line, 140)}`);
}

function shorten(text: string, max: number): string {
  const oneLine = sanitize(text).replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function sanitize(text: unknown): string {
  return String(text)
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
