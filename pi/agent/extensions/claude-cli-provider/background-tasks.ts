import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Best-effort visibility into the Claude Agent SDK's own background "Task" tool
 * calls made while `claude-cli-provider` runs a Pi turn through the SDK.
 *
 * The SDK writes one append-only JSONL transcript per task to an undocumented,
 * internal-only directory:
 *
 *   {os.tmpdir()}/claude-{uid}/{slugified cwd}/{claude session id}/tasks/{taskId}.output
 *
 * There is no public API for this and no authoritative "done" signal on disk -
 * unlike managed-background-jobs' explicit state.json, a task's liveness can
 * only be inferred from how recently its output file was modified ("file size
 * growth = activity"). This module is intentionally defensive: any failure
 * (missing directory, unexpected layout, unparsable line, non-POSIX platform)
 * results in an empty list rather than a thrown error, since this is a nice-to-have
 * status signal, not something the provider should ever depend on.
 */

export interface BackgroundTaskInfo {
  /** Task id, taken from the output filename (matches the SDK's internal agentId). */
  id: string;
  /** Short label for the sub-agent that ran this task, e.g. "Explore" or "coder". */
  label: string;
  /** First line of the task's prompt/description, truncated. */
  taskPreview: string;
  /** Epoch ms of the task's first transcript line, if parsable. */
  startedAt?: number;
  /** Epoch ms the output file was last modified (proxy for "still active"). */
  lastActivityAt: number;
  /** Whether the file has been modified within `staleMs` of `now`. */
  active: boolean;
  outputPath: string;
}

export interface ScanOptions {
  cwd: string;
  sessionId?: string;
  now?: number;
  /** Only used by tests to point at a fake tmp root instead of the real OS tmp dir. */
  tmpRootOverride?: string;
  /** A file not modified within this window is treated as no longer active. Default 20s. */
  staleMs?: number;
  /** Files not modified within this window are dropped entirely. Default 6 hours. */
  forgetMs?: number;
}

const DEFAULT_STALE_MS = 20_000;
const DEFAULT_FORGET_MS = 6 * 60 * 60 * 1000;
const READ_CHUNK_BYTES = 8 * 1024;

/**
 * Mirrors the Claude Code CLI's project-directory slugification: every
 * character that is not a letter or digit becomes a single `-`.
 */
export function slugifyCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

function tasksDir(options: ScanOptions): string | undefined {
  if (!options.sessionId) return undefined;
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid === undefined) return undefined;
  const tmpRoot = options.tmpRootOverride ?? os.tmpdir();
  return path.join(tmpRoot, `claude-${uid}`, slugifyCwd(options.cwd), options.sessionId, "tasks");
}

interface ParsedLine {
  timestamp?: number;
  attributionAgent?: string;
  agentId?: string;
  taskPreview?: string;
}

function firstUserText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string") return text;
      }
    }
  }
  return undefined;
}

function parseLine(line: string): ParsedLine | undefined {
  if (!line.trim()) return undefined;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!record || typeof record !== "object") return undefined;
  const r = record as Record<string, unknown>;
  const timestamp = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : undefined;
  const agentId = typeof r.agentId === "string" ? r.agentId : undefined;
  const attributionAgent = typeof r.attributionAgent === "string" ? r.attributionAgent : undefined;
  const message = r.message && typeof r.message === "object" ? (r.message as Record<string, unknown>) : undefined;
  const taskPreview = message && r.type === "user" ? firstUserText(message.content) : undefined;
  return {
    timestamp: Number.isFinite(timestamp) ? timestamp : undefined,
    agentId,
    attributionAgent,
    taskPreview,
  };
}

function readEdgeLines(filePath: string, size: number): { first?: ParsedLine; last?: ParsedLine } {
  const fd = fs.openSync(filePath, "r");
  try {
    const headLength = Math.min(size, READ_CHUNK_BYTES);
    const headBuffer = Buffer.alloc(headLength);
    fs.readSync(fd, headBuffer, 0, headLength, 0);
    const headText = headBuffer.toString("utf8");
    const firstNewline = headText.indexOf("\n");
    const firstLine = firstNewline === -1 ? headText : headText.slice(0, firstNewline);

    const tailLength = Math.min(size, READ_CHUNK_BYTES);
    const tailBuffer = Buffer.alloc(tailLength);
    fs.readSync(fd, tailBuffer, 0, tailLength, Math.max(0, size - tailLength));
    const tailText = tailBuffer.toString("utf8");
    const lines = tailText.split("\n").map((l) => l.trim()).filter(Boolean);
    const lastLine = lines.length > 0 ? lines[lines.length - 1] : undefined;

    return {
      first: parseLine(firstLine),
      last: lastLine ? parseLine(lastLine) : undefined,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function truncate(text: string, maxLen: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length > maxLen ? `${singleLine.slice(0, maxLen - 1)}…` : singleLine;
}

/**
 * List Claude Agent SDK background tasks for the given cwd/session, best-effort.
 * Never throws; returns [] on any unexpected condition.
 */
export function scanBackgroundTasks(options: ScanOptions): BackgroundTaskInfo[] {
  try {
    const dir = tasksDir(options);
    if (!dir) return [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const now = options.now ?? Date.now();
    const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
    const forgetMs = options.forgetMs ?? DEFAULT_FORGET_MS;

    const results: BackgroundTaskInfo[] = [];
    for (const entry of entries) {
      // `.output` entries are sometimes regular files (while actively written) and
      // sometimes symlinks into `~/.claude/projects/.../subagents/*.jsonl` (once
      // rotated to their persistent home), so accept both - readdir's Dirent
      // reflects lstat and never reports isFile() for a symlink.
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (!entry.name.endsWith(".output")) continue;
      const outputPath = path.join(dir, entry.name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(outputPath);
      } catch {
        continue;
      }
      const lastActivityAt = stat.mtimeMs;
      if (now - lastActivityAt > forgetMs || stat.size === 0) continue;

      let edges: { first?: ParsedLine; last?: ParsedLine };
      try {
        edges = readEdgeLines(outputPath, stat.size);
      } catch {
        continue;
      }

      const id = entry.name.slice(0, -".output".length);
      const label = edges.last?.attributionAgent ?? edges.first?.attributionAgent ?? "subagent";
      const taskPreview = edges.first?.taskPreview ? truncate(edges.first.taskPreview, 70) : "(no task preview)";

      results.push({
        id,
        label,
        taskPreview,
        startedAt: edges.first?.timestamp,
        lastActivityAt,
        active: now - lastActivityAt <= staleMs,
        outputPath,
      });
    }

    results.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    return results;
  } catch {
    return [];
  }
}

export function formatTaskDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

/**
 * Build a compact footer status line for currently-active background tasks,
 * e.g. "⚙ 2 claude bg tasks (Explore 3m12s, coder 1m04s)". Returns undefined
 * when nothing is currently active.
 */
export function describeBackgroundTasks(tasks: BackgroundTaskInfo[], now = Date.now()): string | undefined {
  const active = tasks.filter((task) => task.active);
  if (active.length === 0) return undefined;
  const shown = active.slice(0, 3).map((task) => {
    const elapsedMs = task.startedAt !== undefined ? Math.max(0, now - task.startedAt) : undefined;
    const elapsed = elapsedMs !== undefined ? ` ${formatTaskDuration(elapsedMs)}` : "";
    return `${task.label}${elapsed}`;
  });
  const hidden = active.length - shown.length;
  const suffix = hidden > 0 ? `, +${hidden} more` : "";
  const label = active.length === 1 ? "claude bg task" : "claude bg tasks";
  return `⚙ ${active.length} ${label} (${shown.join(", ")}${suffix})`;
}
