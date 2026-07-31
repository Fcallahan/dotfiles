import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type JobStatus =
  | "starting"
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "stopped"
  | "timed_out"
  | "orphaned";

export type JobLaunch =
  | { kind: "shell"; command: string }
  | { kind: "exec"; executable: string; args: string[] };

export interface JobSpec {
  version: 1;
  id: string;
  title: string;
  launch: JobLaunch;
  cwd: string;
  createdAt: string;
  timeoutSeconds?: number;
  sessionId?: string;
  environment?: Record<string, string>;
  kind?: string;
}

export interface JobState {
  version: 1;
  id: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
  supervisorPid?: number;
  processPid?: number;
  exitCode?: number | null;
  signal?: string | null;
  error?: string;
}

export interface ManagedJob {
  spec: JobSpec;
  state: JobState;
  dir: string;
  outputPath: string;
}

export interface StartJobOptions {
  title?: string;
  launch: JobLaunch;
  cwd: string;
  timeoutSeconds?: number;
  sessionId?: string;
  environment?: Record<string, string>;
  kind?: string;
  rootDir?: string;
}

const TERMINAL = new Set<JobStatus>(["completed", "failed", "stopped", "timed_out", "orphaned"]);
const activeForegroundJobs = new Map<string, () => void>();

export function jobsRoot(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
  return path.join(agentDir, "background-jobs");
}

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL.has(status);
}

export function registerForegroundJob(id: string): { promoted: Promise<void>; dispose: () => void } {
  let resolvePromotion!: () => void;
  const promoted = new Promise<void>((resolve) => { resolvePromotion = resolve; });
  activeForegroundJobs.set(id, resolvePromotion);
  return {
    promoted,
    dispose: () => activeForegroundJobs.delete(id),
  };
}

export function promoteForegroundJobs(): string[] {
  const entries = [...activeForegroundJobs.entries()];
  activeForegroundJobs.clear();
  for (const [, promote] of entries) promote();
  return entries.map(([id]) => id);
}

export function foregroundJobCount(): number {
  return activeForegroundJobs.size;
}

export async function startManagedJob(options: StartJobOptions): Promise<ManagedJob> {
  const root = options.rootDir ?? jobsRoot();
  const id = createJobId();
  const dir = path.join(root, id);
  const outputPath = path.join(dir, "output.log");
  const specPath = path.join(dir, "spec.json");
  const statePath = path.join(dir, "state.json");
  const now = new Date().toISOString();
  const spec: JobSpec = {
    version: 1,
    id,
    title: cleanTitle(options.title ?? launchLabel(options.launch)),
    launch: options.launch,
    cwd: path.resolve(options.cwd),
    createdAt: now,
    timeoutSeconds: normalizeTimeout(options.timeoutSeconds),
    sessionId: options.sessionId,
    environment: options.environment,
    kind: options.kind,
  };
  const state: JobState = {
    version: 1,
    id,
    status: "starting",
    createdAt: now,
    updatedAt: now,
  };

  const cwdStat = await fsp.stat(spec.cwd).catch(() => undefined);
  if (!cwdStat?.isDirectory()) throw new Error(`Managed job cwd is not a directory: ${spec.cwd}`);

  await fsp.mkdir(dir, { recursive: true });
  await Promise.all([
    atomicWriteJson(specPath, spec),
    atomicWriteJson(statePath, state),
    fsp.writeFile(outputPath, "", { flag: "a" }),
  ]);

  const supervisorPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "supervisor.mjs");
  let supervisor: ReturnType<typeof spawn>;
  try {
    supervisor = spawn(process.execPath, [supervisorPath, specPath], {
      cwd: spec.cwd,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PI_BACKGROUND_JOB_ID: id },
    });
  } catch (error) {
    await markStartupFailed(statePath, state, error);
    throw error;
  }

  const startupFailure = new Promise<never>((_resolve, reject) => {
    supervisor.once("error", (error) => {
      void markStartupFailed(statePath, state, error)
        .then(() => reject(error), reject);
    });
    supervisor.once("exit", (code, signal) => {
      if (code === 0) return;
      void delay(25).then(async () => {
        const current = await readJson<JobState>(statePath).catch(() => state);
        if (current.status !== "starting") return;
        const error = new Error(`Background supervisor exited before startup (${code ?? signal ?? "unknown"}).`);
        await markStartupFailed(statePath, current, error);
        reject(error);
      }).catch(reject);
    });
  });
  supervisor.unref();

  const job = await Promise.race([waitForJobStart(dir, 2_000), startupFailure]);
  if (job.state.status === "failed") {
    throw new Error(job.state.error ?? `Background job ${id} failed to start.`);
  }
  return job;
}

export async function getManagedJob(id: string, rootDir = jobsRoot()): Promise<ManagedJob> {
  validateJobId(id);
  const dir = path.join(rootDir, id);
  const [spec, state] = await Promise.all([
    readJson<JobSpec>(path.join(dir, "spec.json")),
    readJson<JobState>(path.join(dir, "state.json")),
  ]);
  const refreshed = refreshLiveness(state);
  return { spec, state: refreshed, dir, outputPath: path.join(dir, "output.log") };
}

export async function listManagedJobs(rootDir = jobsRoot()): Promise<ManagedJob[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(rootDir, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const jobs = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && /^[a-z0-9-]+$/.test(entry.name))
    .map((entry) => getManagedJob(entry.name, rootDir).catch(() => undefined)));
  return jobs.filter((job): job is ManagedJob => Boolean(job))
    .sort((a, b) => b.spec.createdAt.localeCompare(a.spec.createdAt));
}

export async function readJobOutput(job: ManagedJob, maxBytes = 32 * 1024): Promise<string> {
  const current = await readFileTail(job.outputPath, maxBytes);
  if (current.bytes >= maxBytes || !fs.existsSync(`${job.outputPath}.1`)) return current.text;
  const previous = await readFileTail(`${job.outputPath}.1`, maxBytes - current.bytes);
  const combined = `${previous.text}${previous.text && current.text ? "\n[... log rotated ...]\n" : ""}${current.text}`;
  return previous.truncated ? `[... earlier output omitted ...]\n${combined}` : combined;
}

export async function pruneManagedJobs(olderThanDays = 14, rootDir = jobsRoot()): Promise<string[]> {
  const cutoff = Date.now() - Math.max(1, olderThanDays) * 86_400_000;
  const jobs = await listManagedJobs(rootDir);
  const removed: string[] = [];
  for (const job of jobs) {
    if (!isTerminalStatus(job.state.status)) continue;
    const finished = Date.parse(job.state.finishedAt ?? job.state.updatedAt ?? job.spec.createdAt);
    if (!Number.isFinite(finished) || finished >= cutoff) continue;
    await fsp.rm(job.dir, { recursive: true, force: true });
    removed.push(job.spec.id);
  }
  return removed;
}

export async function stopManagedJob(
  id: string,
  options: { graceSeconds?: number; force?: boolean; rootDir?: string } = {},
): Promise<ManagedJob> {
  let job = await getManagedJob(id, options.rootDir);
  if (isTerminalStatus(job.state.status)) return job;

  await atomicWriteJson(path.join(job.dir, "control.json"), {
    action: "stop",
    requestedAt: new Date().toISOString(),
  });
  signalSupervisor(job, "SIGTERM");
  const deadline = Date.now() + Math.max(0, options.graceSeconds ?? 10) * 1_000;
  while (Date.now() < deadline) {
    await delay(200);
    job = await getManagedJob(id, options.rootDir);
    if (isTerminalStatus(job.state.status)) return job;
  }

  if (options.force) {
    signalProcessTree(job, "SIGKILL");
    await delay(250);
    job = await getManagedJob(id, options.rootDir);
  }
  return job;
}

export async function restartManagedJob(
  id: string,
  options: { graceSeconds?: number; force?: boolean; sessionId?: string; rootDir?: string } = {},
): Promise<ManagedJob> {
  const previous = await getManagedJob(id, options.rootDir);
  const stopped = await stopManagedJob(id, options);
  if (!isTerminalStatus(stopped.state.status)) {
    throw new Error(`Job ${id} is still ${stopped.state.status}; stop it before restarting.`);
  }
  return startManagedJob({
    title: previous.spec.title,
    launch: previous.spec.launch,
    cwd: previous.spec.cwd,
    timeoutSeconds: previous.spec.timeoutSeconds,
    sessionId: options.sessionId ?? previous.spec.sessionId,
    environment: previous.spec.environment,
    kind: previous.spec.kind,
    rootDir: options.rootDir,
  });
}

export function formatJob(job: ManagedJob): string {
  const pid = job.state.processPid ? ` pid=${job.state.processPid}` : "";
  const exit = job.state.exitCode != null ? ` exit=${job.state.exitCode}` : "";
  return `${job.spec.id} [${job.state.status}] ${job.spec.title}${pid}${exit}\n  cwd: ${job.spec.cwd}\n  output: ${job.outputPath}`;
}

function signalSupervisor(job: ManagedJob, signal: NodeJS.Signals): void {
  if (process.platform === "win32") {
    signalProcessTree(job, signal);
    return;
  }
  if (job.state.supervisorPid && isAlive(job.state.supervisorPid)) {
    try {
      process.kill(job.state.supervisorPid, signal);
      return;
    } catch {}
  }
  signalProcessTree(job, signal);
}

function signalProcessTree(job: ManagedJob, signal: NodeJS.Signals): void {
  const pid = job.state.processPid;
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])], {
        detached: true,
        stdio: "ignore",
      });
      killer.unref();
    } else {
      process.kill(-pid, signal);
    }
  } catch {}
}

function refreshLiveness(state: JobState): JobState {
  if (!new Set<JobStatus>(["starting", "running", "stopping"]).has(state.status)) return state;
  if (state.processPid && isAlive(state.processPid)) return state;
  if (state.supervisorPid && isAlive(state.supervisorPid)) return state;
  const updatedAt = Date.parse(state.updatedAt);
  if (Number.isFinite(updatedAt) && Date.now() - updatedAt < 2_000) return state;
  return {
    ...state,
    status: "orphaned",
    finishedAt: state.finishedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: state.error ?? "Neither the supervisor nor the managed process is running.",
  };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === "EPERM";
  }
}

async function waitForJobStart(dir: string, timeoutMs: number): Promise<ManagedJob> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = await readJson<JobState>(path.join(dir, "state.json"));
      if (state.status !== "starting") {
        const spec = await readJson<JobSpec>(path.join(dir, "spec.json"));
        return { spec, state, dir, outputPath: path.join(dir, "output.log") };
      }
    } catch {}
    await delay(50);
  }
  const spec = await readJson<JobSpec>(path.join(dir, "spec.json"));
  const state = await readJson<JobState>(path.join(dir, "state.json"));
  return { spec, state, dir, outputPath: path.join(dir, "output.log") };
}

async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await fsp.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(temp, file);
}

async function markStartupFailed(statePath: string, initial: JobState, error: unknown): Promise<void> {
  const now = new Date().toISOString();
  await atomicWriteJson(statePath, {
    ...initial,
    status: "failed",
    finishedAt: now,
    updatedAt: now,
    error: error instanceof Error ? error.message : String(error),
  } satisfies JobState);
}

async function readFileTail(file: string, maxBytes: number): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const handle = await fsp.open(file, "r").catch((error: any) => {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  });
  if (!handle) return { text: "", bytes: 0, truncated: false };
  try {
    const stat = await handle.stat();
    const requested = Math.max(1, maxBytes);
    const length = Math.min(stat.size, requested + 4);
    if (length === 0) return { text: "", bytes: 0, truncated: false };
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    let text = buffer.toString("utf8");
    if (stat.size > length) text = text.replace(/^\uFFFD+/, "");
    return { text, bytes: Math.min(stat.size, requested), truncated: stat.size > requested };
  } finally {
    await handle.close();
  }
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fsp.readFile(file, "utf8")) as T;
}

function createJobId(): string {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function validateJobId(id: string): void {
  if (!/^job-[a-z0-9-]+$/.test(id)) throw new Error(`Invalid background job id: ${id}`);
}

function launchLabel(launch: JobLaunch): string {
  return launch.kind === "shell" ? launch.command : [launch.executable, ...launch.args].join(" ");
}

function cleanTitle(title: string): string {
  return title
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "background job";
}

function normalizeTimeout(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
