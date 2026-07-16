import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentTaskRuntimeStatus, PhaseRuntimeStatus, WorkflowEvent, WorkflowRunStatus } from "./types.ts";
import { appendJsonl, ensureDir, nowIso, safeWriteText, truncateText, writeJsonFile } from "./utils.ts";

export class ContextStore {
  private db: any | undefined;

  private constructor(public runDir: string) {}

  static async open(runDir: string): Promise<ContextStore> {
    ensureDir(runDir);
    ensureDir(path.join(runDir, "artifacts"));
    ensureDir(path.join(runDir, "agents"));
    ensureDir(path.join(runDir, "worktrees"));
    const store = new ContextStore(runDir);
    await store.openSqlite();
    return store;
  }

  private async openSqlite(): Promise<void> {
    try {
      const sqlite = await import("node:sqlite");
      this.db = new sqlite.DatabaseSync(path.join(this.runDir, "context.sqlite"));
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec(schemaSql);
    } catch (error) {
      // SQLite is best-effort in early Node versions. Files/status.json remain the source of truth.
      this.db = undefined;
      safeWriteText(path.join(this.runDir, "context.sqlite.unavailable.txt"), String(error));
    }
  }

  close(): void {
    try { this.db?.close?.(); } catch { /* ignore */ }
  }

  appendEvent(event: Omit<WorkflowEvent, "ts"> & { ts?: string }): void {
    const full = { ts: event.ts ?? nowIso(), ...event };
    appendJsonl(path.join(this.runDir, "events.jsonl"), full);
  }

  putArtifact(name: string, content: string | Buffer): string {
    const safe = name.replace(/^\/+/, "").replace(/\.\.(?:\/|\\)/g, "");
    const file = path.join(this.runDir, "artifacts", safe);
    safeWriteText(file, content);
    return file;
  }

  getArtifact(ref: string): string | Buffer {
    return fs.readFileSync(path.isAbsolute(ref) ? ref : path.join(this.runDir, ref));
  }

  putContext(runId: string, key: string, type: string, value: unknown, createdBy?: string): void {
    const artifactRef = typeof value === "string" && value.length > 8000
      ? this.putArtifact(`${key.replace(/[^a-z0-9._-]+/gi, "-")}.md`, value)
      : undefined;
    const valueJson = artifactRef ? undefined : JSON.stringify(value);
    this.dbRun(
      `INSERT INTO context_items (id, run_id, key, type, value_json, artifact_ref, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), runId, key, type, valueJson ?? null, artifactRef ?? null, createdBy ?? null, nowIso()],
    );
  }

  putRun(status: WorkflowRunStatus): void {
    writeJsonFile(path.join(this.runDir, "status.json"), status);
    this.dbRun(
      `INSERT OR REPLACE INTO workflow_runs
       (id, name, task, status, created_at, updated_at, started_at, completed_at, max_parallel_agents, max_total_agents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [status.id, status.name, status.task, status.status, status.created_at, status.updated_at, status.started_at ?? null, status.completed_at ?? null, status.max_parallel_agents, status.max_total_agents],
    );
  }

  putPhase(runId: string, phase: PhaseRuntimeStatus): void {
    this.dbRun(
      `INSERT OR REPLACE INTO workflow_phases
       (id, run_id, phase_key, type, status, depends_on_json, started_at, completed_at, output_ref, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [phase.id, runId, phase.id, phase.type, phase.status, JSON.stringify(phase.depends_on), phase.started_at ?? null, phase.completed_at ?? null, phase.output_ref ?? null, phase.error ?? null],
    );
  }

  putAgentTask(runId: string, task: AgentTaskRuntimeStatus): void {
    this.dbRun(
      `INSERT OR REPLACE INTO agent_tasks
       (id, run_id, phase_id, agent_name, status, prompt_ref, result_ref, transcript_ref, worktree_path, started_at, completed_at, tokens_input, tokens_output, cost_estimate_cents, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [task.id, runId, task.phase_id, task.agent_name, task.status, task.prompt_ref, task.result_ref ?? null, task.transcript_ref ?? null, task.worktree_path ?? null, task.started_at ?? null, task.completed_at ?? null, task.tokens_input ?? 0, task.tokens_output ?? 0, task.cost_estimate_cents ?? 0, task.error ?? null],
    );
  }

  putFindings(runId: string, agentTaskId: string, output: unknown): void {
    const maybe = output as { findings?: unknown };
    if (!Array.isArray(maybe?.findings)) return;
    for (const item of maybe.findings) {
      if (!item || typeof item !== "object") continue;
      const f = item as Record<string, unknown>;
      this.dbRun(
        `INSERT INTO findings
         (id, run_id, agent_task_id, severity, title, description, file_path, line_start, line_end, evidence, recommendation, confidence, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
        [
          randomUUID(),
          runId,
          agentTaskId,
          String(f.severity ?? "INFO"),
          String(f.title ?? "Untitled finding"),
          String(f.description ?? ""),
          typeof f.file_path === "string" ? f.file_path : null,
          typeof f.line_start === "number" ? f.line_start : null,
          typeof f.line_end === "number" ? f.line_end : null,
          truncateText(String(f.evidence ?? ""), 8000),
          truncateText(String(f.recommendation ?? ""), 8000),
          typeof f.confidence === "number" ? f.confidence : 0,
        ],
      );
    }
  }

  private dbRun(sql: string, params: unknown[]): void {
    try {
      this.db?.prepare(sql).run(...params);
    } catch (error) {
      appendJsonl(path.join(this.runDir, "sqlite-errors.jsonl"), { ts: nowIso(), error: String(error), sql });
    }
  }
}

const schemaSql = `
CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    task TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    max_parallel_agents INTEGER NOT NULL,
    max_total_agents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_phases (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    phase_key TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    depends_on_json TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    output_ref TEXT,
    error TEXT,
    FOREIGN KEY(run_id) REFERENCES workflow_runs(id)
);

CREATE TABLE IF NOT EXISTS agent_tasks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    phase_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    status TEXT NOT NULL,
    prompt_ref TEXT NOT NULL,
    result_ref TEXT,
    transcript_ref TEXT,
    worktree_path TEXT,
    started_at TEXT,
    completed_at TEXT,
    tokens_input INTEGER DEFAULT 0,
    tokens_output INTEGER DEFAULT 0,
    cost_estimate_cents INTEGER DEFAULT 0,
    error TEXT,
    FOREIGN KEY(run_id) REFERENCES workflow_runs(id),
    FOREIGN KEY(phase_id) REFERENCES workflow_phases(id)
);

CREATE TABLE IF NOT EXISTS context_items (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    key TEXT NOT NULL,
    type TEXT NOT NULL,
    value_json TEXT,
    artifact_ref TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(run_id) REFERENCES workflow_runs(id)
);

CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    agent_task_id TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    file_path TEXT,
    line_start INTEGER,
    line_end INTEGER,
    evidence TEXT,
    recommendation TEXT,
    confidence REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    FOREIGN KEY(run_id) REFERENCES workflow_runs(id),
    FOREIGN KEY(agent_task_id) REFERENCES agent_tasks(id)
);
`;
