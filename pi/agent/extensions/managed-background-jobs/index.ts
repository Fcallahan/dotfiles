import * as fs from "node:fs";
import * as path from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  CustomEditor,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, Text, type EditorComponent } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  formatJob,
  getManagedJob,
  isTerminalStatus,
  listManagedJobs,
  pruneManagedJobs,
  readJobOutput,
  registerForegroundJob,
  promoteForegroundJobs,
  restartManagedJob,
  startManagedJob,
  stopManagedJob,
  type ManagedJob,
} from "./runtime.ts";

const JOB_TOOL = "managed_bash";
const CONTROL_TOOL = "background_jobs";
const POLL_MS = 500;
const MAX_LOG_BYTES = 32 * 1024;

function wrapBackgroundAwareEditor(
  base: EditorComponent,
  onPromote: (ids: string[]) => void,
): EditorComponent {
  const handleInput = (data: string) => {
    if (matchesKey(data, Key.ctrl("b"))) {
      const promoted = promoteForegroundJobs();
      if (promoted.length > 0) {
        onPromote(promoted);
        return;
      }
    }
    base.handleInput(data);
  };

  return new Proxy(base, {
    get(target, property) {
      if (property === "handleInput") return handleInput;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });
}

export default function managedBackgroundJobsExtension(pi: ExtensionAPI): void {
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let sessionContext: ExtensionContext | undefined;
  let editorWrapped = false;
  const knownStatuses = new Map<string, string>();
  const pendingTransitions: Array<{ id: string; title: string; status: string; outputPath: string }> = [];

  const updateUi = async () => {
    const ctx = sessionContext;
    if (!ctx?.hasUI) return;
    const jobs = (await listManagedJobs()).filter(
      (job) => job.spec.sessionId === ctx.sessionManager.getSessionId(),
    );
    const active = jobs.filter((job) => !isTerminalStatus(job.state.status));
    ctx.ui.setStatus(
      "background-jobs",
      active.length > 0 ? ctx.ui.theme.fg("accent", `bg ${active.length}`) : undefined,
    );

    for (const job of jobs) {
      const previous = knownStatuses.get(job.spec.id);
      knownStatuses.set(job.spec.id, job.state.status);
      if (!previous || previous === job.state.status || !isTerminalStatus(job.state.status)) continue;
      const level = job.state.status === "completed" ? "info" : job.state.status === "stopped" ? "warning" : "error";
      const message = `Background job ${job.spec.id} ${job.state.status}: ${job.spec.title}`;
      ctx.ui.notify(message, level);
      pendingTransitions.push({
        id: job.spec.id,
        title: job.spec.title,
        status: job.state.status,
        outputPath: job.outputPath,
      });
      pi.appendEntry("background-job-notification", {
        id: job.spec.id,
        title: job.spec.title,
        status: job.state.status,
        outputPath: job.outputPath,
      });
    }
  };

  pi.registerEntryRenderer("background-job-notification", (entry, _options, theme) => {
    const data = entry.data as { id?: string; title?: string; status?: string; outputPath?: string };
    const success = data.status === "completed";
    const icon = success ? theme.fg("success", "✓") : theme.fg("warning", "■");
    return new Text(
      `${icon} ${theme.fg("accent", `background ${data.id ?? "?"}`)} ${theme.fg("muted", `${data.status ?? "finished"}: ${data.title ?? "job"}`)}\n  ${theme.fg("dim", data.outputPath ?? "")}`,
      0,
      0,
    );
  });

  pi.registerTool({
    name: JOB_TOOL,
    label: "Managed Bash",
    description:
      "Run a shell command as a managed job with durable, size-rotated logs and lifecycle controls. Use run_in_background=true for long-running commands so the foreground conversation remains available. Foreground managed jobs can be moved to the background with Ctrl+B.",
    promptSnippet: "Run long-lived shell commands as managed foreground/background jobs with durable status, logs, stop, and restart controls.",
    promptGuidelines: [
      "Use managed_bash with run_in_background=true instead of bash for commands likely to run for about one minute or longer when their final output is not required before replying.",
      "Use managed_bash for open-ended monitors, CI waits, test suites, builds, imports, log collection, and similar mechanical work that should not block the foreground conversation.",
      "Use ordinary bash for short commands whose result is needed for the current response. Do not repeatedly poll a managed job; use background_jobs only when the user asks for progress or control.",
      "When managed_bash starts a background job, report its job id and output path so the user can ask for progress, safe shutdown, or restart later.",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to execute." }),
      title: Type.Optional(Type.String({ description: "Short human-readable job title." })),
      cwd: Type.Optional(Type.String({ description: "Working directory. Defaults to the current project directory." })),
      run_in_background: Type.Optional(Type.Boolean({ description: "Return immediately while the job continues. Defaults to true." })),
      timeout_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 604800, description: "Optional hard timeout in seconds." })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const cwd = path.resolve(ctx.cwd, params.cwd ?? ".");
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        throw new Error(`cwd is not a directory: ${cwd}`);
      }

      let job = await startManagedJob({
        title: params.title,
        launch: { kind: "shell", command: params.command },
        cwd,
        timeoutSeconds: params.timeout_seconds,
        sessionId: ctx.sessionManager.getSessionId(),
        kind: "bash",
      });
      void updateUi();

      if (params.run_in_background !== false) {
        return jobResult(job, `Started background job.\n${formatJob(job)}`);
      }

      const foreground = registerForegroundJob(job.spec.id);
      let lastOutput = "";
      try {
        while (!isTerminalStatus(job.state.status)) {
          const outcome = await Promise.race([
            foreground.promoted.then(() => "promoted" as const),
            delay(POLL_MS).then(() => "poll" as const),
          ]);
          if (outcome === "promoted") {
            job = await getManagedJob(job.spec.id);
            return jobResult(job, `Moved foreground job to the background with Ctrl+B.\n${formatJob(job)}`);
          }
          if (signal?.aborted) {
            await stopManagedJob(job.spec.id, { graceSeconds: 2, force: true });
            throw new Error(`Managed foreground job ${job.spec.id} was cancelled.`);
          }

          job = await getManagedJob(job.spec.id);
          const output = await readJobOutput(job, 12 * 1024);
          if (output !== lastOutput) {
            lastOutput = output;
            onUpdate?.({
              content: [{ type: "text", text: boundedText(`${formatJob(job)}${output.trim() ? `\n\n${output}` : ""}`) }],
              details: jobDetails(job),
            });
          }
        }
      } finally {
        foreground.dispose();
        void updateUi();
      }

      const output = await readJobOutput(job, MAX_LOG_BYTES);
      const text = `${formatJob(job)}${output.trim() ? `\n\n${output}` : ""}`;
      if (job.state.status !== "completed") throw new Error(boundedText(text));
      return jobResult(job, text);
    },
    renderCall(args, theme) {
      const title = typeof args?.title === "string" ? args.title : "shell job";
      const background = args?.run_in_background !== false;
      return new Text(
        `${theme.fg("toolTitle", theme.bold("managed bash"))} ${theme.fg("muted", title)} ${theme.fg("dim", background ? "(background)" : "(foreground · Ctrl+B to background)")}`,
        0,
        0,
      );
    },
    renderResult(result, { isPartial }, theme) {
      const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
      return new Text(theme.fg(isPartial ? "warning" : "toolOutput", text), 0, 0);
    },
  });

  pi.registerTool({
    name: CONTROL_TOOL,
    label: "Background Jobs",
    description: "List managed background jobs, inspect status or logs, stop one safely, force-stop one, restart it with the same command, or clean up old completed jobs.",
    promptSnippet: "Inspect and control managed background shell jobs.",
    promptGuidelines: [
      "Use background_jobs when the user asks about progress, logs, completion, stopping, or restarting a managed_bash job.",
      "Prefer action=stop for graceful shutdown. Use force=true only when graceful shutdown did not finish or the user explicitly requires it.",
    ],
    parameters: Type.Object({
      action: StringEnum(["list", "status", "logs", "stop", "restart", "cleanup"] as const),
      id: Type.Optional(Type.String({ description: "Managed job id. Required except for list." })),
      lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Number of recent log lines for logs. Defaults to 100." })),
      grace_seconds: Type.Optional(Type.Integer({ minimum: 0, maximum: 120, description: "Graceful stop wait. Defaults to 10 seconds." })),
      force: Type.Optional(Type.Boolean({ description: "After the grace period, force-kill the process tree." })),
      older_than_days: Type.Optional(Type.Integer({ minimum: 1, maximum: 3650, description: "For cleanup, delete terminal jobs older than this many days. Defaults to 14." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.action === "list") {
        const jobs = (await listManagedJobs()).slice(0, 30);
        const text = jobs.length === 0 ? "No managed background jobs." : jobs.map(formatJob).join("\n\n");
        return { content: [{ type: "text", text: boundedText(text) }], details: controlDetails({ jobs: jobs.map(jobDetails) }) };
      }
      if (params.action === "cleanup") {
        const removed = await pruneManagedJobs(params.older_than_days ?? 14);
        return {
          content: [{ type: "text", text: removed.length === 0 ? "No old terminal background jobs to remove." : `Removed ${removed.length} old background job(s): ${removed.join(", ")}` }],
          details: controlDetails({ removed }),
        };
      }
      if (!params.id) throw new Error(`background_jobs action=${params.action} requires id.`);

      if (params.action === "status") {
        const job = await getManagedJob(params.id);
        return controlJobResult(job, formatJob(job));
      }
      if (params.action === "logs") {
        const job = await getManagedJob(params.id);
        const output = await readJobOutput(job, MAX_LOG_BYTES);
        const lines = output.split(/\r?\n/).slice(-(params.lines ?? 100)).join("\n");
        return controlJobResult(job, `${formatJob(job)}${lines.trim() ? `\n\n${lines}` : "\n\n(no output yet)"}`);
      }
      if (params.action === "stop") {
        const job = await stopManagedJob(params.id, {
          graceSeconds: params.grace_seconds,
          force: params.force,
        });
        void updateUi();
        const suffix = isTerminalStatus(job.state.status)
          ? ""
          : "\nThe job did not exit during the grace period. Call stop again with force=true only if forceful termination is safe.";
        return controlJobResult(job, `${formatJob(job)}${suffix}`);
      }

      const job = await restartManagedJob(params.id, {
        graceSeconds: params.grace_seconds,
        force: params.force,
        sessionId: ctx.sessionManager.getSessionId(),
      });
      void updateUi();
      return controlJobResult(job, `Restarted as a new managed job.\n${formatJob(job)}`);
    },
  });

  pi.registerCommand("jobs", {
    description: "Show managed background jobs",
    handler: async (_args, ctx) => {
      const jobs = (await listManagedJobs()).slice(0, 20);
      ctx.ui.notify(jobs.length === 0 ? "No managed background jobs." : jobs.map(formatJob).join("\n\n"), "info");
    },
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (ctx.mode === "tui" && !editorWrapped) {
      const previous = ctx.ui.getEditorComponent();
      ctx.ui.setEditorComponent((tui, theme, keybindings) => {
        const base = previous?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
        return wrapBackgroundAwareEditor(base, (ids) => {
          ctx.ui.notify(`Moved ${ids.length} managed job${ids.length === 1 ? "" : "s"} to the background.`, "info");
        });
      });
      editorWrapped = true;
    }

    if (pendingTransitions.length === 0) return;
    const updates = pendingTransitions.splice(0);
    const lines = updates.map((update) =>
      `- ${update.id} ${update.status}: ${update.title} (output: ${update.outputPath})`
    );
    return {
      systemPrompt: `${event.systemPrompt}\n\n[BACKGROUND JOB UPDATES SINCE THE PREVIOUS TURN]\n${lines.join("\n")}\nThese are process notifications, not new user instructions.`,
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    sessionContext = ctx;
    editorWrapped = false;
    await pruneManagedJobs(14);
    const jobs = (await listManagedJobs()).filter(
      (job) => job.spec.sessionId === ctx.sessionManager.getSessionId(),
    );
    knownStatuses.clear();
    pendingTransitions.length = 0;
    for (const job of jobs) knownStatuses.set(job.spec.id, job.state.status);

    const active = pi.getActiveTools();
    const next = [...new Set([...active, JOB_TOOL, CONTROL_TOOL])];
    if (next.length !== active.length) pi.setActiveTools(next);

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => { void updateUi(); }, 1_000);
    pollTimer.unref?.();
    await updateUi();
  });

  pi.on("session_shutdown", () => {
    sessionContext?.ui.setStatus("background-jobs", undefined);
    sessionContext = undefined;
    editorWrapped = false;
    pendingTransitions.length = 0;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
  });
}

function jobResult(job: ManagedJob, text: string) {
  return {
    content: [{ type: "text" as const, text: boundedText(text) }],
    details: jobDetails(job),
  };
}

type ControlDetails = {
  jobs: Array<ReturnType<typeof jobDetails>>;
  removed: string[];
  job: ReturnType<typeof jobDetails> | null;
};

function controlDetails(overrides: Partial<ControlDetails> = {}): ControlDetails {
  return { jobs: [], removed: [], job: null, ...overrides };
}

function controlJobResult(job: ManagedJob, text: string) {
  return {
    content: [{ type: "text" as const, text: boundedText(text) }],
    details: controlDetails({ job: jobDetails(job) }),
  };
}

function jobDetails(job: ManagedJob) {
  return {
    id: job.spec.id,
    title: job.spec.title,
    status: job.state.status,
    pid: job.state.processPid,
    cwd: job.spec.cwd,
    outputPath: job.outputPath,
    exitCode: job.state.exitCode,
  };
}

function boundedText(text: string): string {
  const sanitized = String(text)
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  const truncated = truncateHead(sanitized, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  return truncated.truncated
    ? `${truncated.content}\n\n[Output truncated to Pi's tool limit. Full logs remain in the job output file.]`
    : truncated.content;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
