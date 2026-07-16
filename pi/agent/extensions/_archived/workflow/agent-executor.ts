import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { AgentDefinition, AgentResult, ExecuteAgentOptions } from "./types.ts";
import { getSchemaByName } from "./schemas.ts";
import { ensureDir, extractJsonFromText, getFinalAssistantText, getPiInvocation, nowIso, safeWriteText, truncateText } from "./utils.ts";

const TASK_ARG_LIMIT = 8000;

type Usage = { input: number; output: number; cost: number };

export async function executeAgentTask(options: ExecuteAgentOptions): Promise<AgentResult> {
  const taskDir = path.join(options.runDir, "agents", options.taskId);
  ensureDir(taskDir);

  const workingDirectory = options.isolation === "worktree" && options.cwd ? options.cwd : options.cwd;
  const allowedPiTools = resolvePiTools(options.agent);
  const prompt = buildRuntimePrompt(options, allowedPiTools);
  const promptPath = path.join(taskDir, "prompt.md");
  const taskPath = path.join(taskDir, "task.md");
  const transcriptJsonPath = path.join(taskDir, "transcript.json");
  const transcriptMdPath = path.join(taskDir, "transcript.md");
  const resultPath = path.join(taskDir, "result.json");

  safeWriteText(promptPath, prompt);
  safeWriteText(taskPath, buildUserTask(options));

  const args = ["--mode", "json", "-p", "--no-session", "--append-system-prompt", promptPath];
  if (allowedPiTools.length > 0) args.push("--tools", allowedPiTools.join(","));
  else args.push("--no-tools");

  const model = options.agent.model ?? (options.workflow.runtime.default_model !== "default" ? options.workflow.runtime.default_model : undefined);
  if (model && model !== "default") args.push("--model", model);
  const thinking = effortToThinking(options.agent.effort ?? options.workflow.runtime.default_effort);
  if (thinking) args.push("--thinking", thinking);

  const taskText = fs.readFileSync(taskPath, "utf8");
  if (taskText.length > TASK_ARG_LIMIT) {
    args.push(`@${taskPath}`, "Execute the workflow subagent task described in the attached file.");
  } else {
    args.push(taskText);
  }

  const messages: any[] = [];
  const usage: Usage = { input: 0, output: 0, cost: 0 };
  let stderr = "";
  let stdoutRemainder = "";
  let stopReason: string | undefined;
  let errorMessage: string | undefined;
  let timedOut = false;
  let aborted = false;

  const timeoutMs = Math.max(1, options.agent.timeout_seconds ?? 900) * 1000;
  const exitCode = await new Promise<number>((resolve) => {
    const invocation = getPiInvocation(args);
    const proc = spawn(invocation.command, invocation.args, {
      cwd: workingDirectory,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PI_WORKFLOW_CHILD: "1",
        PI_WORKFLOW_RUN_ID: options.runId,
        PI_WORKFLOW_TASK_ID: options.taskId,
        PI_WORKFLOW_AGENT: options.agent.name,
      },
    });

    const kill = (reason: "timeout" | "abort") => {
      if (reason === "timeout") timedOut = true;
      if (reason === "abort") aborted = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 5000).unref?.();
    };

    const timeout = setTimeout(() => kill("timeout"), timeoutMs);
    const onAbort = () => kill("abort");
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const processLine = (line: string) => {
      if (!line.trim()) return;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === "message_end" && event.message) {
        const msg = event.message;
        messages.push(msg);
        if (msg.role === "assistant") {
          const u = msg.usage;
          if (u) {
            usage.input += Number(u.input || 0);
            usage.output += Number(u.output || 0);
            usage.cost += Number(u.cost?.total || 0);
          }
          if (msg.stopReason) stopReason = msg.stopReason;
          if (msg.errorMessage) errorMessage = msg.errorMessage;
        }
      } else if (event.type === "tool_result_end" && event.message) {
        messages.push(event.message);
      }
    };

    proc.stdout.on("data", (chunk) => {
      stdoutRemainder += chunk.toString();
      const lines = stdoutRemainder.split("\n");
      stdoutRemainder = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    });
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    proc.on("error", (error) => {
      stderr += String(error);
      clearTimeout(timeout);
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
      resolve(1);
    });
    proc.on("close", (code) => {
      if (stdoutRemainder.trim()) processLine(stdoutRemainder);
      clearTimeout(timeout);
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
      resolve(code ?? 0);
    });
  });

  safeWriteText(transcriptJsonPath, `${JSON.stringify({ messages, stderr, exitCode, stopReason, errorMessage }, null, 2)}\n`);
  safeWriteText(transcriptMdPath, renderTranscript(messages, stderr));

  const finalText = getFinalAssistantText(messages);
  const outputJson = extractJsonFromText(finalText);
  const status = timedOut ? "timeout" : aborted ? "cancelled" : exitCode === 0 && stopReason !== "error" && !errorMessage ? "completed" : "failed";
  const result: AgentResult = {
    status,
    summary: summarizeResult(finalText, status, stderr || errorMessage),
    output_json: outputJson,
    raw_output: finalText,
    transcript_ref: transcriptMdPath,
    artifacts: [promptPath, transcriptJsonPath],
    token_usage: { input: usage.input, output: usage.output },
    cost_estimate_cents: Math.round(usage.cost * 100),
    error: status === "completed" ? undefined : (errorMessage || stderr || `Child pi exited with code ${exitCode}`),
  };
  safeWriteText(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function resolvePiTools(agent: AgentDefinition): string[] {
  const requested = agent.tools ?? [];
  const mutating = requested.some((tool) => ["write_file", "apply_patch", "shell_mutating"].includes(tool));
  const test = requested.includes("shell_test");
  const readonlyShell = requested.includes("shell_readonly");
  const out = new Set<string>();

  if (requested.includes("read_file")) out.add("read");
  if (requested.includes("list_files")) { out.add("ls"); out.add("find"); }
  if (requested.includes("grep") || requested.includes("ripgrep")) { out.add("grep"); out.add("find"); }
  if (mutating) { out.add("read"); out.add("grep"); out.add("find"); out.add("ls"); out.add("edit"); out.add("write"); out.add("bash"); }
  if (test) { out.add("read"); out.add("grep"); out.add("find"); out.add("ls"); out.add("bash"); }
  // Do not grant bash for read-only shell by default; the runtime supplies git diff/status artifacts.
  if (readonlyShell && agent.permission_mode && agent.permission_mode !== "readonly") out.add("bash");

  for (const denied of agent.disallowed_tools ?? []) {
    for (const mapped of mapToolName(denied)) out.delete(mapped);
  }
  return Array.from(out).sort();
}

function mapToolName(name: string): string[] {
  switch (name) {
    case "read_file": return ["read"];
    case "list_files": return ["ls", "find"];
    case "grep": case "ripgrep": return ["grep"];
    case "write_file": return ["write"];
    case "apply_patch": return ["edit", "write"];
    case "shell_readonly": case "shell_test": case "shell_mutating": case "git_diff": case "git_status": return ["bash"];
    default: return [name];
  }
}

function effortToThinking(effort?: string): string | undefined {
  switch (effort) {
    case "low": return "low";
    case "medium": return "medium";
    case "high": return "high";
    case "xhigh": return "xhigh";
    default: return undefined;
  }
}

function buildRuntimePrompt(options: ExecuteAgentOptions, piTools: string[]): string {
  const schema = getSchemaByName(options.agent.output_schema);
  const allowedWorkflowTools = options.agent.tools ?? [];
  return `You are running as a Pi workflow subagent.

Run ID: ${options.runId}
Task ID: ${options.taskId}
Agent: ${options.agent.name}
Phase: ${options.phaseId}
Working directory: ${options.cwd}
Started: ${nowIso()}

You have isolated context. Do not assume the parent chat has seen your intermediate work.

Workflow-level allowed capabilities:
${allowedWorkflowTools.map((tool) => `- ${tool}`).join("\n") || "- none"}

Pi tools enabled for this child process:
${piTools.map((tool) => `- ${tool}`).join("\n") || "- none"}

Permission rules:
- Stay inside your assigned scope.
- Do not modify files unless your role explicitly allows mutation.
- Read-only reviewers must not call mutating tools and have no write/edit tools enabled.
- If bash is enabled, use it only for the shell capability your role permits.
- Cite file paths and line numbers when available.
- Prefer concrete evidence over generic advice.
- If uncertain, mark confidence below 0.6.
- Return a compact final result. Raw notes belong in artifacts, not final output.
- Your final assistant message must be valid JSON${schema ? " matching this schema" : ""}. Do not wrap it in prose.

Output schema name: ${options.agent.output_schema ?? "unspecified"}
${schema ? JSON.stringify(schema, null, 2) : ""}

Agent role prompt:
${options.agent.prompt}
`;
}

function buildUserTask(options: ExecuteAgentOptions): string {
  return `# Workflow subagent task

Run ID: ${options.runId}
Task ID: ${options.taskId}
Agent: ${options.agent.name}
Phase: ${options.phaseId}

## User task
${options.userTask}

## Phase prompt
${options.phasePrompt ?? "(none)"}

## Phase input
\`\`\`json
${JSON.stringify(options.phaseInput ?? {}, null, 2)}
\`\`\`

## Context refs
${options.contextRefs.map((ref) => `- ${ref}`).join("\n") || "- (none)"}

Read the referenced artifacts if they are relevant. Produce the required final JSON only.
`;
}

function renderTranscript(messages: any[], stderr: string): string {
  const parts = ["# Agent transcript"];
  for (const msg of messages) {
    parts.push(`\n## ${msg.role ?? "message"}`);
    const content = msg.content;
    if (typeof content === "string") parts.push(content);
    else if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "text") parts.push(part.text);
        else if (part.type === "toolCall") parts.push(`\nTool call: ${part.name}\n\`\`\`json\n${JSON.stringify(part.arguments, null, 2)}\n\`\`\``);
      }
    } else {
      parts.push(`\`\`\`json\n${JSON.stringify(msg, null, 2)}\n\`\`\``);
    }
  }
  if (stderr.trim()) parts.push(`\n## stderr\n\`\`\`\n${truncateText(stderr)}\n\`\`\``);
  return `${parts.join("\n")}\n`;
}

function summarizeResult(finalText: string, status: AgentResult["status"], error?: string): string {
  if (status !== "completed") return `${status}: ${truncateText(error || "agent failed", 1000)}`;
  const parsed = extractJsonFromText(finalText) as { summary?: unknown } | undefined;
  if (parsed && typeof parsed === "object" && typeof parsed.summary === "string") return parsed.summary;
  return truncateText(finalText.replace(/\s+/g, " ").trim(), 1000) || "completed";
}
