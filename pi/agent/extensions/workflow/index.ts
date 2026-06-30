import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { AgentRegistry, writeDefaultAgentFiles } from "./agent-registry.ts";
import { classifyTask, codeReviewWorkflow, implementFeatureWorkflow, migrationAuditWorkflow } from "./templates.ts";
import { loadWorkflow, parseWorkflowText, writeWorkflowFile } from "./workflow-loader.ts";
import { createWorkflowRun, formatStatus, loadRunStatus, needsMutation, renderPlan, resolveRunDir, runWorkflow } from "./runtime.ts";
import { getRunsDir, getWorkflowsDir, hasFlag, pathExists, readJsonFile, splitArgs, truncateText, writeJsonFile } from "./utils.ts";
import type { Workflow, WorkflowRunStatus } from "./types.ts";

const activeRuns = new Map<string, AbortController>();
const subcommands = new Set(["run", "list", "status", "resume", "stop", "save", "show", "init", "help"]);

export default function (pi: ExtensionAPI) {
  if (process.env.PI_WORKFLOW_CHILD === "1") {
    pi.registerCommand("workflow", {
      description: "Workflow orchestration is disabled inside workflow child agents",
      handler: async (_args, ctx) => emit(pi, ctx, "Workflow orchestration is disabled inside workflow child agents.", "warning"),
    });
    return;
  }

  pi.registerCommand("workflow", {
    description: "Run deterministic multi-agent workflows: /workflow <task>, /workflow run <yaml>, /workflow status <run-id>",
    handler: async (args, ctx) => {
      try {
        await handleWorkflowCommand(pi, ctx, args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit(pi, ctx, `Workflow error: ${message}`, "error");
      }
    },
  });
}

async function handleWorkflowCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, rawArgs: string): Promise<void> {
  const trimmed = rawArgs.trim();
  const tokens = splitArgs(trimmed);
  const first = tokens[0];
  if (!trimmed || first === "help" || first === "--help" || first === "-h") {
    emit(pi, ctx, helpText());
    return;
  }

  if (first && subcommands.has(first)) {
    const rest = trimmed.slice(first.length).trim();
    switch (first) {
      case "run": return handleRun(pi, ctx, rest);
      case "list": return handleList(pi, ctx);
      case "status": return handleStatus(pi, ctx, rest);
      case "resume": return handleResume(pi, ctx, rest);
      case "stop": return handleStop(pi, ctx, rest);
      case "save": return handleSave(pi, ctx, rest);
      case "show": return handleShow(pi, ctx, rest);
      case "init": return handleInit(pi, ctx, rest);
    }
  }

  await handleGeneratedWorkflow(pi, ctx, trimmed);
}

async function handleGeneratedWorkflow(pi: ExtensionAPI, ctx: ExtensionCommandContext, raw: string): Promise<void> {
  const tokens = splitArgs(raw);
  const yes = hasFlag(tokens, "--yes", "-y");
  const dryRun = hasFlag(tokens, "--dry-run", "--plan");
  const task = stripWorkflowFlags(tokens).join(" ").trim();
  if (!task) {
    emit(pi, ctx, "Usage: /workflow <task>", "error");
    return;
  }
  const classification = classifyTask(unquote(task));
  const workflow = classification.workflow;
  await createPlanAndRun(pi, ctx, workflow, "<generated>", unquote(task), { yes, dryRun, reason: classification.reason });
}

async function handleRun(pi: ExtensionAPI, ctx: ExtensionCommandContext, raw: string): Promise<void> {
  const tokens = splitArgs(raw);
  const yes = hasFlag(tokens, "--yes", "-y");
  const dryRun = hasFlag(tokens, "--dry-run", "--plan");
  const delimiter = raw.indexOf(" -- ");
  const beforeDelimiter = delimiter === -1 ? raw : raw.slice(0, delimiter);
  const afterDelimiter = delimiter === -1 ? "" : raw.slice(delimiter + 4).trim();
  const beforeTokens = splitArgs(beforeDelimiter);
  const target = beforeTokens.find((token) => !token.startsWith("--") && token !== "-y");
  if (!target) {
    emit(pi, ctx, "Usage: /workflow run <workflow.yaml|name> --task \"task\" [--yes]", "error");
    return;
  }
  const taskFlagIndex = tokens.indexOf("--task");
  const task = taskFlagIndex !== -1 ? tokens[taskFlagIndex + 1] : afterDelimiter || target;
  const loaded = loadWorkflow(ctx.cwd, target, unquote(task));
  await createPlanAndRun(pi, ctx, loaded.workflow, loaded.filePath, unquote(task), { yes, dryRun });
}

async function handleResume(pi: ExtensionAPI, ctx: ExtensionCommandContext, raw: string): Promise<void> {
  const tokens = splitArgs(raw);
  const id = tokens.find((token) => !token.startsWith("--"));
  if (!id) {
    emit(pi, ctx, "Usage: /workflow resume <run-id> [--yes]", "error");
    return;
  }
  const status = loadRunStatus(ctx.cwd, id);
  const workflow = parseWorkflowText(fs.readFileSync(path.join(status.run_dir, "run.yaml"), "utf8"), path.join(status.run_dir, "run.yaml"));
  const registry = AgentRegistry.load(status.cwd);
  let approved = Boolean(status.mutation_approved) || hasFlag(tokens, "--yes", "-y");
  if (needsMutation(workflow, registry) && !approved && ctx.hasUI) {
    approved = await ctx.ui.confirm("Approve workflow mutation?", renderPlan(workflow, registry));
  }
  if (needsMutation(workflow, registry) && !approved) {
    status.status = "pending_approval";
    status.error = "Resume requires mutation approval. Run /workflow resume <run-id> --yes or approve in TUI.";
    writeJsonFile(path.join(status.run_dir, "status.json"), status);
    emit(pi, ctx, `${formatStatus(status)}\nResume requires approval.`, "warning");
    return;
  }
  await executeRun(pi, ctx, workflow, status, registry, approved);
}

async function createPlanAndRun(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  workflow: Workflow,
  workflowFile: string,
  task: string,
  opts: { yes?: boolean; dryRun?: boolean; reason?: string } = {},
): Promise<void> {
  const registry = AgentRegistry.load(ctx.cwd);
  const plan = renderPlan(workflow, registry);
  const status = await createWorkflowRun(ctx.cwd, workflow, workflowFile, task);
  const mutation = needsMutation(workflow, registry);
  let text = `${plan}\nRun ID: ${status.id}\nRun dir: ${status.run_dir}\n`;
  if (opts.reason) text += `\nClassification: ${opts.reason}\n`;
  emit(pi, ctx, text);

  if (opts.dryRun) {
    emit(pi, ctx, `Dry run only. Inspect: ${status.run_dir}`);
    return;
  }

  let approved = Boolean(opts.yes);
  if (!approved && ctx.hasUI) {
    const label = mutation ? "Proceed and approve mutation gate?" : "Proceed with read-only workflow?";
    approved = await ctx.ui.confirm(label, `${workflow.name}\n\n${mutation ? "File writes may occur in worktrees after approval." : "No file writes requested."}`);
  }
  if (!approved && (mutation || !ctx.hasUI)) {
    status.status = "pending_approval";
    status.error = ctx.hasUI ? "User did not approve execution." : "Non-interactive workflow execution requires --yes.";
    writeJsonFile(path.join(status.run_dir, "status.json"), status);
    emit(pi, ctx, `${formatStatus(status)}\nNot executed. Resume with: /workflow resume ${status.id} --yes`, "warning");
    return;
  }

  await executeRun(pi, ctx, workflow, status, registry, approved);
}

async function executeRun(pi: ExtensionAPI, ctx: ExtensionCommandContext, workflow: Workflow, status: WorkflowRunStatus, registry: AgentRegistry, approved: boolean): Promise<void> {
  const controller = new AbortController();
  activeRuns.set(status.id, controller);
  try {
    if (ctx.hasUI) ctx.ui.setStatus("workflow", `${status.id}: running`);
    const final = await runWorkflow(status.cwd, workflow, status, registry, {
      approveMutations: approved,
      signal: controller.signal,
      onUpdate: (s) => {
        if (ctx.hasUI) ctx.ui.setStatus("workflow", `${s.id}: ${s.status}`);
      },
    });
    const reportPath = final.artifacts.final_report;
    const report = reportPath && pathExists(reportPath) ? fs.readFileSync(reportPath, "utf8") : formatStatus(final);
    emit(pi, ctx, `${truncateText(report, 30_000)}\n\n---\n${formatStatus(final)}`, final.status === "completed" ? "info" : "warning");
  } finally {
    activeRuns.delete(status.id);
    if (ctx.hasUI) ctx.ui.setStatus("workflow", undefined);
  }
}

async function handleList(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const workflowDir = getWorkflowsDir(ctx.cwd);
  const workflows = pathExists(workflowDir)
    ? fs.readdirSync(workflowDir).filter((name) => /\.(ya?ml|json)$/.test(name)).sort()
    : [];
  const runsDir = getRunsDir(ctx.cwd);
  const runs = pathExists(runsDir)
    ? fs.readdirSync(runsDir).filter((name) => pathExists(path.join(runsDir, name, "status.json"))).sort().slice(-10).reverse()
    : [];
  emit(pi, ctx, `# Workflows\n\n${workflows.map((w) => `- ${w}`).join("\n") || "No saved workflows. Run /workflow init."}\n\n# Recent runs\n\n${runs.map((r) => `- ${r}`).join("\n") || "No runs yet."}\n`);
}

async function handleStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext, raw: string): Promise<void> {
  const id = splitArgs(raw)[0];
  if (!id) {
    emit(pi, ctx, "Usage: /workflow status <run-id>", "error");
    return;
  }
  emit(pi, ctx, formatStatus(loadRunStatus(ctx.cwd, id)));
}

async function handleShow(pi: ExtensionAPI, ctx: ExtensionCommandContext, raw: string): Promise<void> {
  const id = splitArgs(raw)[0];
  if (!id) {
    emit(pi, ctx, "Usage: /workflow show <run-id>", "error");
    return;
  }
  const status = loadRunStatus(ctx.cwd, id);
  const runYaml = fs.readFileSync(path.join(status.run_dir, "run.yaml"), "utf8");
  emit(pi, ctx, `${formatStatus(status)}\n\n# run.yaml\n\n\`\`\`yaml\n${runYaml}\n\`\`\``);
}

async function handleStop(pi: ExtensionAPI, ctx: ExtensionCommandContext, raw: string): Promise<void> {
  const id = splitArgs(raw)[0];
  if (!id) {
    emit(pi, ctx, "Usage: /workflow stop <run-id>", "error");
    return;
  }
  activeRuns.get(id)?.abort();
  const runDir = resolveRunDir(ctx.cwd, id);
  const status = readJsonFile<WorkflowRunStatus>(path.join(runDir, "status.json"));
  status.stopped = true;
  status.status = "cancelled";
  status.updated_at = new Date().toISOString();
  writeJsonFile(path.join(runDir, "status.json"), status);
  emit(pi, ctx, `Stopped workflow run ${status.id}.`);
}

async function handleSave(pi: ExtensionAPI, ctx: ExtensionCommandContext, raw: string): Promise<void> {
  const tokens = splitArgs(raw);
  const [id, name] = tokens;
  if (!id || !name) {
    emit(pi, ctx, "Usage: /workflow save <run-id> <name>", "error");
    return;
  }
  const status = loadRunStatus(ctx.cwd, id);
  const workflow = parseWorkflowText(fs.readFileSync(path.join(status.run_dir, "run.yaml"), "utf8"), path.join(status.run_dir, "run.yaml"));
  const file = writeWorkflowFile(ctx.cwd, name, workflow, hasFlag(tokens, "--force"));
  emit(pi, ctx, `Saved workflow: ${file}`);
}

async function handleInit(pi: ExtensionAPI, ctx: ExtensionCommandContext, raw: string): Promise<void> {
  const tokens = splitArgs(raw);
  const overwrite = hasFlag(tokens, "--force", "--overwrite");
  const workflows = [
    writeWorkflowFile(ctx.cwd, "code-review", codeReviewWorkflow(), overwrite),
    writeWorkflowFile(ctx.cwd, "implement-feature", implementFeatureWorkflow(), overwrite),
    writeWorkflowFile(ctx.cwd, "migration-audit", migrationAuditWorkflow(), overwrite),
  ];
  const agents = writeDefaultAgentFiles(ctx.cwd, overwrite);
  emit(pi, ctx, `Initialized workflow assets.\n\nWorkflows:\n${workflows.map((f) => `- ${f}`).join("\n")}\n\nAgents written: ${agents.length}\n${agents.map((f) => `- ${f}`).join("\n")}`);
}

function stripWorkflowFlags(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (["--yes", "-y", "--dry-run", "--plan"].includes(token)) continue;
    out.push(token);
  }
  return out;
}

function unquote(input: string): string {
  const trimmed = input.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function emit(pi: ExtensionAPI, ctx: ExtensionCommandContext, text: string, level: "info" | "warning" | "error" = "info"): void {
  if (ctx.mode === "print") {
    console.log(text);
    return;
  }
  pi.sendMessage({ customType: "workflow", content: text, display: true, details: { level } });
  if (ctx.hasUI && level !== "info") ctx.ui.notify(text.split("\n")[0] ?? text, level);
}

function helpText(): string {
  return `# /workflow

Commands:
- /workflow <task> [--yes] [--dry-run]
- /workflow run <workflow.yaml|name> --task "..." [--yes]
- /workflow list
- /workflow status <run-id>
- /workflow resume <run-id> [--yes]
- /workflow stop <run-id>
- /workflow save <run-id> <name>
- /workflow show <run-id>
- /workflow init [--force]

Run data is stored under .pi/runs/<run-id>/ with run.yaml, status.json, events.jsonl, context.sqlite, artifacts, agent outputs, and worktrees.
`;
}
