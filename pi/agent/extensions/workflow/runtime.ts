import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentDefinition, AgentResult, AgentTaskRuntimeStatus, Phase, PhaseRuntimeStatus, Workflow, WorkflowRunStatus } from "./types.ts";
import { AgentRegistry } from "./agent-registry.ts";
import { ContextStore } from "./context-store.ts";
import { executeAgentTask } from "./agent-executor.ts";
import { WorktreeManager } from "./worktree-manager.ts";
import { stringifyYaml } from "./yaml.ts";
import { execFileText, getRunsDir, makeRunId, nowIso, pathExists, readJsonFile, safeWriteText, slugify, truncateText, writeJsonFile } from "./utils.ts";

const terminalPhaseStatuses = new Set(["completed", "failed", "cancelled", "skipped"]);

export interface RunOptions {
  approveMutations?: boolean;
  signal?: AbortSignal;
  onUpdate?: (status: WorkflowRunStatus) => void;
}

export async function createWorkflowRun(cwd: string, workflow: Workflow, workflowFile: string, task: string): Promise<WorkflowRunStatus> {
  const runId = makeRunId(workflow.name);
  const runDir = path.join(getRunsDir(cwd), runId);
  const created = nowIso();
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(runDir, "artifacts"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "agents"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "worktrees"), { recursive: true });
  const runYaml = path.join(runDir, "run.yaml");
  safeWriteText(runYaml, `${stringifyYaml(workflow)}\n`);

  const status: WorkflowRunStatus = {
    id: runId,
    name: workflow.name,
    task,
    cwd,
    run_dir: runDir,
    workflow_file: workflowFile === `<generated>` ? runYaml : workflowFile,
    status: "created",
    created_at: created,
    updated_at: created,
    max_parallel_agents: workflow.runtime.max_parallel_agents,
    max_total_agents: workflow.runtime.max_total_agents,
    agent_count: 0,
    mutation_approved: false,
    phases: {},
    tasks: {},
    outputs: {},
    artifacts: {},
  };

  for (const phase of workflow.phases) {
    status.phases[phase.id] = {
      id: phase.id,
      type: phase.type,
      status: "queued",
      depends_on: phase.depends_on ?? [],
      task_ids: [],
    };
  }

  const store = await ContextStore.open(runDir);
  try {
    const wm = new WorktreeManager(cwd, runDir);
    status.artifacts = await wm.snapshotGit(path.join(runDir, "artifacts"));
    store.appendEvent({ type: "run.created", run_id: runId, name: workflow.name });
    persistStatus(store, status);
  } finally {
    store.close();
  }
  return status;
}

export function loadRunStatus(cwd: string, idOrPrefix: string): WorkflowRunStatus {
  const runDir = resolveRunDir(cwd, idOrPrefix);
  return readJsonFile<WorkflowRunStatus>(path.join(runDir, "status.json"));
}

export function resolveRunDir(cwd: string, idOrPrefix: string): string {
  const direct = path.join(getRunsDir(cwd), idOrPrefix);
  if (pathExists(path.join(direct, "status.json"))) return direct;
  const runsDir = getRunsDir(cwd);
  if (!pathExists(runsDir)) throw new Error(`No workflow runs directory: ${runsDir}`);
  const matches = fs.readdirSync(runsDir).filter((entry) => entry.startsWith(idOrPrefix) && pathExists(path.join(runsDir, entry, "status.json")));
  if (matches.length === 0) throw new Error(`Workflow run not found: ${idOrPrefix}`);
  if (matches.length > 1) throw new Error(`Ambiguous run id '${idOrPrefix}': ${matches.join(", ")}`);
  return path.join(runsDir, matches[0]!);
}

export async function runWorkflow(cwd: string, workflow: Workflow, status: WorkflowRunStatus, registry: AgentRegistry, options: RunOptions = {}): Promise<WorkflowRunStatus> {
  const store = await ContextStore.open(status.run_dir);
  const worktrees = new WorktreeManager(cwd, status.run_dir);
  const startedAt = Date.now();
  try {
    if (options.approveMutations) status.mutation_approved = true;
    if (status.status === "created" || status.status === "pending_approval") {
      status.status = "running";
      status.started_at ??= nowIso();
      store.appendEvent({ type: "run.started", run_id: status.id });
      persistStatus(store, status, options);
    }
    resetIncompleteForResume(status);

    while (!allPhasesTerminal(status)) {
      if (options.signal?.aborted || status.stopped) throw new Error("Workflow cancelled");
      if ((Date.now() - startedAt) / 60000 > workflow.runtime.max_runtime_minutes) throw new Error("Workflow runtime limit exceeded");
      const ready = workflow.phases.filter((phase) => status.phases[phase.id]?.status === "queued" && depsCompleted(status, phase));
      if (ready.length === 0) {
        const nonTerminal = Object.values(status.phases).filter((phase) => !terminalPhaseStatuses.has(phase.status));
        if (nonTerminal.length > 0) throw new Error(`No runnable phases; blocked phases: ${nonTerminal.map((p) => p.id).join(", ")}`);
        break;
      }

      for (const phase of ready) {
        if (options.signal?.aborted || status.stopped) throw new Error("Workflow cancelled");
        await runPhase(phase, workflow, status, registry, store, worktrees, options);
        if (status.phases[phase.id]?.status === "pending_approval") {
          status.status = "pending_approval";
          store.appendEvent({ type: "run.pending_approval", run_id: status.id, phase: phase.id });
          persistStatus(store, status, options);
          return status;
        }
        if (workflow.runtime.fail_fast && status.phases[phase.id]?.status === "failed") cancelDescendants(workflow, status, phase.id);
      }
    }

    if (Object.values(status.phases).some((phase) => phase.status === "failed")) status.status = "failed";
    else if (Object.values(status.phases).some((phase) => phase.status === "cancelled")) status.status = "cancelled";
    else status.status = "completed";
    status.completed_at = nowIso();
    await writeFinalArtifacts(status, workflow, store, worktrees);
    store.appendEvent({ type: `run.${status.status}`, run_id: status.id });
    persistStatus(store, status, options);
    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status.status = message.includes("approval") ? "pending_approval" : message.includes("cancel") ? "cancelled" : "failed";
    status.error = message;
    status.completed_at = nowIso();
    if (status.status !== "pending_approval") {
      try { await writeFinalArtifacts(status, workflow, store, worktrees); } catch { /* best effort */ }
    }
    store.appendEvent({ type: "run.failed", run_id: status.id, error: message });
    persistStatus(store, status, options);
    return status;
  } finally {
    store.close();
  }
}

async function runPhase(phase: Phase, workflow: Workflow, status: WorkflowRunStatus, registry: AgentRegistry, store: ContextStore, worktrees: WorktreeManager, options: RunOptions): Promise<void> {
  const phaseStatus = status.phases[phase.id]!;
  phaseStatus.status = "running";
  phaseStatus.started_at = nowIso();
  store.appendEvent({ type: "phase.started", run_id: status.id, phase: phase.id });
  persistPhaseAndStatus(store, status, phaseStatus, options);

  try {
    if (phase.type === "agent") {
      const result = await runAgentInPhase(phase, phase.agent, 0, workflow, status, registry, store, worktrees, options);
      const output = normalizePhaseOutput(result);
      status.outputs[phase.id] = output;
      phaseStatus.output_ref = writePhaseOutput(status, phase, output, result.raw_output);
      store.putContext(status.id, phase.output ?? phase.id, String(phase.output ?? "agent_result"), output, phase.agent);
    } else if (phase.type === "parallel") {
      const results = await runParallelAgents(phase, workflow, status, registry, store, worktrees, options);
      const output = Object.fromEntries(results.map((entry) => [entry.agent, normalizePhaseOutput(entry.result)]));
      status.outputs[phase.id] = output;
      phaseStatus.output_ref = writePhaseOutput(status, phase, output);
      store.putContext(status.id, phase.output ?? phase.id, String(phase.output ?? "parallel_result"), output, phase.id);
      if (results.some((entry) => entry.result.status !== "completed")) throw new Error(`One or more agents failed in phase ${phase.id}`);
    } else if (phase.type === "gate") {
      await runGate(phase, status, store, options);
      status.outputs[phase.id] = { status: "approved" };
    }

    phaseStatus.status = "completed";
    phaseStatus.completed_at = nowIso();
    store.appendEvent({ type: "phase.completed", run_id: status.id, phase: phase.id });
  } catch (error) {
    phaseStatus.status = String(error).includes("approval") ? "pending_approval" : "failed";
    phaseStatus.error = error instanceof Error ? error.message : String(error);
    phaseStatus.completed_at = nowIso();
    store.appendEvent({ type: "phase.failed", run_id: status.id, phase: phase.id, error: phaseStatus.error });
    if (phaseStatus.status === "pending_approval") status.status = "pending_approval";
  }
  persistPhaseAndStatus(store, status, phaseStatus, options);
}

async function runParallelAgents(phase: Extract<Phase, { type: "parallel" }>, workflow: Workflow, status: WorkflowRunStatus, registry: AgentRegistry, store: ContextStore, worktrees: WorktreeManager, options: RunOptions): Promise<Array<{ agent: string; result: AgentResult }>> {
  const limit = Math.max(1, Math.min(workflow.runtime.max_parallel_agents, phase.agents.length));
  const results: Array<{ agent: string; result: AgentResult }> = new Array(phase.agents.length);
  let next = 0;
  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const index = next++;
      if (index >= phase.agents.length) return;
      const agent = phase.agents[index]!;
      const result = await runAgentInPhase(phase, agent, index, workflow, status, registry, store, worktrees, options);
      results[index] = { agent, result };
    }
  });
  await Promise.all(workers);
  return results;
}

async function runAgentInPhase(phase: Phase, agentName: string, index: number, workflow: Workflow, status: WorkflowRunStatus, registry: AgentRegistry, store: ContextStore, worktrees: WorktreeManager, options: RunOptions): Promise<AgentResult> {
  const agent = registry.require(agentName);
  if (status.agent_count >= workflow.runtime.max_total_agents) throw new Error(`max_total_agents exceeded (${workflow.runtime.max_total_agents})`);
  const taskId = `${slugify(phase.id)}-${slugify(agentName)}-${index + 1}`;
  let taskStatus = status.tasks[taskId];
  if (taskStatus?.status === "completed" && taskStatus.result_ref && pathExists(taskStatus.result_ref)) {
    return readJsonFile<AgentResult>(taskStatus.result_ref);
  }

  const taskDir = path.join(status.run_dir, "agents", taskId);
  fs.mkdirSync(taskDir, { recursive: true });
  taskStatus = {
    id: taskId,
    phase_id: phase.id,
    agent_name: agentName,
    status: "queued",
    prompt_ref: path.join(taskDir, "prompt.md"),
  };
  status.tasks[taskId] = taskStatus;
  if (!status.phases[phase.id]!.task_ids.includes(taskId)) status.phases[phase.id]!.task_ids.push(taskId);
  status.agent_count++;
  store.putAgentTask(status.id, taskStatus);
  persistStatus(store, status, options);

  const isolation = resolveIsolation(phase, agent);
  let workingDirectory = status.cwd;
  if (isolation === "worktree") {
    if (!status.mutation_approved) throw new Error("mutation approval required before worktree agent runs");
    workingDirectory = await worktrees.create(status.id, agentName);
    taskStatus.worktree_path = workingDirectory;
  }

  taskStatus.status = "running";
  taskStatus.started_at = nowIso();
  store.appendEvent({ type: "agent.started", run_id: status.id, phase: phase.id, agent: agentName, task_id: taskId });
  store.putAgentTask(status.id, taskStatus);
  persistStatus(store, status, options);

  const result = await executeAgentTask({
    runId: status.id,
    taskId,
    phaseId: phase.id,
    userTask: status.task,
    agent,
    workflow,
    phasePrompt: "prompt" in phase ? phase.prompt : undefined,
    phaseInput: resolvePlaceholders(phase.input ?? {}, status),
    cwd: workingDirectory,
    runDir: status.run_dir,
    contextRefs: buildContextRefs(status),
    isolation,
    signal: options.signal,
  });

  if (isolation === "worktree" && taskStatus.worktree_path) {
    const patch = await worktrees.diff(taskStatus.worktree_path);
    const patchPath = path.join(status.run_dir, "artifacts", `${taskId}.patch`);
    safeWriteText(patchPath, patch || "# No diff produced.\n");
    result.artifacts.push(patchPath);
    if (result.output_json && typeof result.output_json === "object") {
      (result.output_json as Record<string, unknown>).patch_ref = patchPath;
    }
  }

  const resultPath = path.join(taskDir, "result.json");
  writeJsonFile(resultPath, result);
  taskStatus.status = result.status === "completed" ? "completed" : "failed";
  taskStatus.completed_at = nowIso();
  taskStatus.result_ref = resultPath;
  taskStatus.transcript_ref = result.transcript_ref;
  taskStatus.tokens_input = result.token_usage?.input ?? 0;
  taskStatus.tokens_output = result.token_usage?.output ?? 0;
  taskStatus.cost_estimate_cents = result.cost_estimate_cents ?? 0;
  taskStatus.error = result.error;
  store.putAgentTask(status.id, taskStatus);
  store.putFindings(status.id, taskId, result.output_json);
  store.appendEvent({ type: result.status === "completed" ? "agent.completed" : "agent.failed", run_id: status.id, phase: phase.id, agent: agentName, task_id: taskId, result_ref: resultPath });
  persistStatus(store, status, options);
  return result;
}

async function runGate(phase: Extract<Phase, { type: "gate" }>, status: WorkflowRunStatus, store: ContextStore, _options: RunOptions): Promise<void> {
  if (phase.gate === "user_approval") {
    if (!status.mutation_approved) throw new Error("user approval required");
    store.appendEvent({ type: "gate.approved", run_id: status.id, phase: phase.id });
    return;
  }
  if (phase.gate === "test") {
    const command = phase.command;
    if (!command) return;
    const result = await execFileText("bash", ["-lc", command], { cwd: status.cwd, allowFailure: true, timeoutMs: 30 * 60_000 });
    const outputPath = path.join(status.run_dir, "artifacts", `${phase.id}-test-output.txt`);
    safeWriteText(outputPath, `$ ${command}\n\nexit code: ${result.code}\n\nSTDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}`);
    if (result.code !== 0) throw new Error(`test gate failed: ${command} (see ${outputPath})`);
    return;
  }
  // schema_validation is currently enforced by prompts and JSON persistence; no-op gate.
}

function resolveIsolation(phase: Phase, agent: AgentDefinition): "none" | "worktree" {
  if ("isolation" in phase && phase.isolation) return phase.isolation;
  return agent.isolation ?? "none";
}

function normalizePhaseOutput(result: AgentResult): unknown {
  return result.output_json ?? { summary: result.summary, raw_output: result.raw_output, status: result.status, error: result.error };
}

function writePhaseOutput(status: WorkflowRunStatus, phase: Phase, output: unknown, raw?: string): string {
  const file = path.join(status.run_dir, "artifacts", `${phase.id}-output.json`);
  writeJsonFile(file, output);
  if (raw) safeWriteText(path.join(status.run_dir, "artifacts", `${phase.id}-raw-output.md`), raw);
  return file;
}

function buildContextRefs(status: WorkflowRunStatus): string[] {
  const refs = new Set<string>();
  for (const ref of Object.values(status.artifacts)) refs.add(ref);
  for (const phase of Object.values(status.phases)) if (phase.output_ref) refs.add(phase.output_ref);
  return Array.from(refs);
}

function resolvePlaceholders(value: unknown, status: WorkflowRunStatus): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{outputs\.([^}.]+)(?:\.[^}]*)?\}\}/g, (_m, phaseId) => JSON.stringify(status.outputs[phaseId] ?? null))
      .replace(/\{\{artifacts\.([^}]+)\}\}/g, (_m, key) => status.artifacts[key] ?? "");
  }
  if (Array.isArray(value)) return value.map((item) => resolvePlaceholders(item, status));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, resolvePlaceholders(val, status)]));
  }
  return value;
}

function depsCompleted(status: WorkflowRunStatus, phase: Phase): boolean {
  return (phase.depends_on ?? []).every((dep) => status.phases[dep]?.status === "completed");
}

function allPhasesTerminal(status: WorkflowRunStatus): boolean {
  return Object.values(status.phases).every((phase) => terminalPhaseStatuses.has(phase.status));
}

function resetIncompleteForResume(status: WorkflowRunStatus): void {
  for (const phase of Object.values(status.phases)) {
    if (phase.status === "running" || phase.status === "failed" || phase.status === "pending_approval") {
      phase.status = "queued";
      phase.error = undefined;
      phase.completed_at = undefined;
    }
  }
  for (const task of Object.values(status.tasks)) {
    if (task.status === "running" || task.status === "failed") task.status = "queued";
  }
}

function cancelDescendants(workflow: Workflow, status: WorkflowRunStatus, failedPhaseId: string): void {
  const cancelled = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const phase of workflow.phases) {
      if (phase.id === failedPhaseId || cancelled.has(phase.id)) continue;
      if ((phase.depends_on ?? []).some((dep) => dep === failedPhaseId || cancelled.has(dep))) {
        const ps = status.phases[phase.id]!;
        if (!terminalPhaseStatuses.has(ps.status)) {
          ps.status = "cancelled";
          ps.completed_at = nowIso();
          cancelled.add(phase.id);
          changed = true;
        }
      }
    }
  }
}

async function writeFinalArtifacts(status: WorkflowRunStatus, workflow: Workflow, store: ContextStore, worktrees: WorktreeManager): Promise<void> {
  const outputFile = workflow.output?.file ?? "final-report.md";
  const finalPath = path.join(status.run_dir, "artifacts", outputFile);
  const synthPhase = [...workflow.phases].reverse().find((phase) => phase.id.toLowerCase().includes("synth") || phase.output === "final_report");
  const output = synthPhase ? status.outputs[synthPhase.id] : undefined;
  let report = outputToMarkdown(output);
  if (!report.trim()) report = `# Workflow Result: ${status.name}\n\nStatus: ${status.status}\n`;
  report += `\n\n## Artifacts\n\n${Object.entries(status.artifacts).map(([k, v]) => `- ${k}: \`${v}\``).join("\n")}\n`;
  const gitStatus = await worktrees.status(status.cwd);
  report += `\n## Git status\n\n\`\`\`\n${truncateText(gitStatus, 20_000)}\n\`\`\`\n`;
  safeWriteText(finalPath, report);
  status.artifacts.final_report = finalPath;
  store.putContext(status.id, "final_report", "final_report", report, "runtime");
}

function outputToMarkdown(output: unknown): string {
  if (!output) return "";
  if (typeof output === "string") return output;
  if (typeof output === "object") {
    const obj = output as Record<string, unknown>;
    for (const key of ["final_report", "report", "markdown", "summary"]) {
      if (typeof obj[key] === "string") return obj[key] as string;
    }
    return `# Workflow synthesis\n\n\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\`\n`;
  }
  return String(output);
}

function persistPhaseAndStatus(store: ContextStore, status: WorkflowRunStatus, phase: PhaseRuntimeStatus, options?: RunOptions): void {
  store.putPhase(status.id, phase);
  persistStatus(store, status, options);
}

function persistStatus(store: ContextStore, status: WorkflowRunStatus, options?: RunOptions): void {
  status.updated_at = nowIso();
  store.putRun(status);
  options?.onUpdate?.(status);
}

export function renderPlan(workflow: Workflow, registry: AgentRegistry): string {
  const lines = [`# Workflow Plan: ${workflow.name}`, ""];
  if (workflow.description) lines.push(workflow.description, "");
  lines.push("## Phases");
  workflow.phases.forEach((phase, idx) => {
    if (phase.type === "agent") lines.push(`${idx + 1}. ${phase.id} — ${phase.agent}${resolveIsolation(phase, registry.get(phase.agent) ?? ({ isolation: "none" } as AgentDefinition)) === "worktree" ? " (worktree)" : ""}`);
    else if (phase.type === "parallel") lines.push(`${idx + 1}. ${phase.id} — ${phase.agents.join(", ")} in parallel`);
    else lines.push(`${idx + 1}. ${phase.id} — gate: ${phase.gate}`);
  });
  lines.push("", "## Runtime", `- Max agents: ${workflow.runtime.max_total_agents}`, `- Max parallel agents: ${workflow.runtime.max_parallel_agents}`, `- Max runtime: ${workflow.runtime.max_runtime_minutes} minutes`);
  lines.push("", "## Mutation", needsMutation(workflow, registry) ? "- File writes may occur; approval and worktree isolation are required." : "- No file writes requested.");
  return `${lines.join("\n")}\n`;
}

export function needsMutation(workflow: Workflow, registry: AgentRegistry): boolean {
  for (const phase of workflow.phases) {
    const agents = phase.type === "agent" ? [phase.agent] : phase.type === "parallel" ? phase.agents : [];
    for (const name of agents) {
      const agent = registry.get(name);
      if (!agent) continue;
      if (resolveIsolation(phase, agent) === "worktree") return true;
      if ((agent.tools ?? []).some((tool) => ["write_file", "apply_patch", "shell_mutating"].includes(tool))) return true;
    }
  }
  return false;
}

export function formatStatus(status: WorkflowRunStatus): string {
  const lines = [`Run: ${status.id}`, `Status: ${status.status}`];
  if (status.error) lines.push(`Error: ${status.error}`);
  lines.push("", "Phases:");
  for (const phase of Object.values(status.phases)) {
    const icon = phase.status === "completed" ? "✓" : phase.status === "running" ? "▶" : phase.status === "failed" ? "✗" : phase.status === "pending_approval" ? "?" : "○";
    lines.push(`${icon} ${phase.id}`);
    for (const taskId of phase.task_ids) {
      const task = status.tasks[taskId];
      if (!task) continue;
      const tIcon = task.status === "completed" ? "✓" : task.status === "running" ? "▶" : task.status === "failed" ? "✗" : "○";
      lines.push(`  ${tIcon} ${task.agent_name}`);
    }
  }
  lines.push("", "Artifacts:");
  for (const [key, file] of Object.entries(status.artifacts)) lines.push(`- ${key}: ${file}`);
  return `${lines.join("\n")}\n`;
}
