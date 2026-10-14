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
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, Text, type EditorComponent } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  formatDuration,
  formatJob,
  getManagedJob,
  isTerminalStatus,
  jobElapsedMs,
  listManagedJobs,
  pruneManagedJobs,
  readJobOutput,
  registerForegroundJob,
  promoteForegroundJobs,
  restartManagedJob,
  startManagedJob,
  stopManagedJob,
  waitForManagedJob,
  type ManagedJob,
} from "./runtime.ts";
import {
  formatNotification,
  NOTIFICATION_TYPE,
  planDelivery,
  REPORTED_TYPE,
  reportedJobIds,
  unreportedTerminalJobs,
} from "./notifications.ts";

const JOB_TOOL = "managed_bash";
const CONTROL_TOOL = "background_jobs";
const POLL_MS = 500;
const POLL_UI_MS = 1_000;
const MAX_LOG_BYTES = 32 * 1024;
const NOTIFY_LOG_BYTES = 16 * 1024;
const DEFAULT_WAIT_SECONDS = 600;

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
  // Jobs whose result the model is already receiving inline (foreground run or
  // background_jobs wait). Their completion must not also wake the agent.
  const inlineJobs = new Set<string>();
  let failureWakesSinceInput = 0;

  const ensurePoller = () => {
    if (pollTimer) return;
    pollTimer = setInterval(() => { void updateUi(); }, POLL_UI_MS);
    pollTimer.unref?.();
  };

  // `observed` returns the job snapshot whose result the model actually receives.
  // Recording that snapshot (not a fresh read) means a job that finishes just
  // after Ctrl+B promotion is still reported by the poller.
  const watchInline = async <T>(
    id: string,
    run: () => Promise<T>,
    observed: () => ManagedJob | undefined,
  ): Promise<T> => {
    inlineJobs.add(id);
    try {
      return await run();
    } finally {
      const job = observed();
      if (job) {
        knownStatuses.set(id, job.state.status);
        // Mark it reported so session resume does not replay a result the model already saw.
        if (isTerminalStatus(job.state.status)) pi.appendEntry(REPORTED_TYPE, { id });
      }
      inlineJobs.delete(id);
    }
  };

  /**
   * Put a finished job into the model's context. Wake-ups start a turn when Pi
   * is idle and steer the current run when it is busy; other notifications are
   * recorded without starting a turn.
   */
  const deliverNotification = async (ctx: ExtensionContext, job: ManagedJob, recovered = false) => {
    const output = sanitize(await readJobOutput(job, NOTIFY_LOG_BYTES).catch(() => ""));
    if (sessionContext !== ctx) return;
    const planned = planDelivery(job, failureWakesSinceInput);
    const isFailure = job.state.status !== "completed" && job.state.status !== "stopped";
    const failureLimitReached = !recovered && isFailure && job.spec.notify !== false && planned === "next-turn";
    const delivery = recovered ? "next-turn" : planned;
    if (job.state.status === "completed") failureWakesSinceInput = 0;
    else if (delivery === "wake" && isFailure) failureWakesSinceInput += 1;

    if (ctx.hasUI) {
      const level = job.state.status === "completed" ? "info" : job.state.status === "stopped" ? "warning" : "error";
      const suffix = failureLimitReached ? " (auto follow-up paused; waiting for you)" : "";
      ctx.ui.notify(`Background job ${job.spec.id} ${job.state.status}: ${job.spec.title}${suffix}`, level);
    }
    pi.sendMessage(
      {
        customType: NOTIFICATION_TYPE,
        content: formatNotification(job, output, { delivery, recovered, failureLimitReached }),
        display: true,
        details: {
          id: job.spec.id,
          title: job.spec.title,
          status: job.state.status,
          exitCode: job.state.exitCode,
          outputPath: job.outputPath,
          delivery,
          recovered,
        },
      },
      delivery === "wake" ? { triggerTurn: true, deliverAs: "steer" } : { triggerTurn: false },
    );
  };

  const stopPoller = () => {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = undefined;
  };

  // Serialize refreshes: the timer and several tool paths trigger them, and
  // overlapping runs could report the same transition twice.
  let refreshChain: Promise<void> = Promise.resolve();
  const updateUi = (): Promise<void> => {
    refreshChain = refreshChain.then(refresh).catch(() => {});
    return refreshChain;
  };

  // Detects job transitions in every mode (TUI, RPC, headless); only the footer
  // and toasts depend on a UI.
  const refresh = async () => {
    const ctx = sessionContext;
    if (!ctx) return;
    const jobs = (await listManagedJobs()).filter(
      (job) => job.spec.sessionId === ctx.sessionManager.getSessionId(),
    );
    if (sessionContext !== ctx) return;
    const active = jobs.filter((job) => !isTerminalStatus(job.state.status));
    if (ctx.hasUI) {
      ctx.ui.setStatus(
        "background-jobs",
        active.length > 0 ? ctx.ui.theme.fg("accent", describeActiveJobs(active)) : undefined,
      );
    }
    // Only poll while there is something to watch; a running job or the
    // in-flight process of starting one keeps this alive, otherwise it stops.
    if (active.length > 0) ensurePoller();
    else stopPoller();

    // listManagedJobs is newest-first; report oldest-first.
    for (const job of [...jobs].reverse()) {
      if (inlineJobs.has(job.spec.id)) continue;
      const previous = knownStatuses.get(job.spec.id);
      // Terminal statuses are final; never let a stale snapshot move a job back.
      if (previous && isTerminalStatus(previous as ManagedJob["state"]["status"])) continue;
      knownStatuses.set(job.spec.id, job.state.status);
      if (!previous || previous === job.state.status || !isTerminalStatus(job.state.status)) continue;
      await deliverNotification(ctx, job);
    }
  };

  type RenderedFields = { id?: string; title?: string; status?: string; outputPath?: string; delivery?: string };
  const renderNotification = (data: RenderedFields, theme: Theme) => {
    const success = data.status === "completed";
    const icon = success ? theme.fg("success", "✓") : theme.fg("warning", "■");
    const woke = data.delivery === "wake" ? theme.fg("dim", " · agent notified") : "";
    return `${icon} ${theme.fg("accent", `background ${data.id ?? "?"}`)} ${theme.fg("muted", `${data.status ?? "finished"}: ${data.title ?? "job"}`)}${woke}\n  ${theme.fg("dim", data.outputPath ?? "")}`;
  };

  // Legacy TUI-only entries written by earlier versions of this extension.
  pi.registerEntryRenderer(NOTIFICATION_TYPE, (entry, _options, theme) =>
    new Text(renderNotification((entry.data ?? {}) as RenderedFields, theme), 0, 0));
  pi.registerMessageRenderer(NOTIFICATION_TYPE, (message, options, theme) => {
    const summary = renderNotification((message.details ?? {}) as RenderedFields, theme);
    const content = typeof message.content === "string" ? message.content : "";
    return new Text(options.expanded && content ? `${summary}\n\n${theme.fg("dim", content)}` : summary, 0, 0);
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
      "Use ordinary bash for short commands whose result is needed for the current response.",
      "When a background job finishes, Pi automatically sends you a background-job notification with its status, exit code, and last output, and starts a turn if you are idle. Do not poll in a loop and do not wait for the user to ask.",
      "When the next step depends on a background job, say what happens next and end your turn; continue when the notification arrives. For a short dependency you must resolve in the current turn, use background_jobs action=wait instead.",
      "When a notification reports a failure the task depends on, read the log, classify it (real defect, environment or infrastructure, or too-short timeout), then fix and retry at most twice for the same failure before reporting the exact error to the user.",
      "Set notify=false for long-lived services the user watches (dev servers, dashboards, watchers, interactive review UIs) so their exit does not start an agent turn.",
      "Set timeout_seconds generously enough for cold builds and app startup; a timeout that kills a healthy job wastes a full cycle.",
      "When managed_bash starts a background job, report its job id and output path.",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to execute." }),
      title: Type.Optional(Type.String({ description: "Short human-readable job title." })),
      cwd: Type.Optional(Type.String({ description: "Working directory. Defaults to the current project directory." })),
      run_in_background: Type.Optional(Type.Boolean({ description: "Return immediately while the job continues. Defaults to true." })),
      timeout_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 604800, description: "Optional hard timeout in seconds." })),
      notify: Type.Optional(Type.Boolean({ description: "Start an agent turn when this background job finishes. Defaults to true; use false for user-watched long-lived services." })),
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
        notify: params.notify,
      });
      const background = params.run_in_background !== false;
      if (!background) inlineJobs.add(job.spec.id);
      // Seed a non-terminal status so a job that finishes before the next poll still
      // counts as a transition and gets reported.
      knownStatuses.set(job.spec.id, "starting");
      void updateUi();

      if (background) {
        const wake = params.notify === false
          ? "notify=false: finishing will not start an agent turn."
          : "You will be notified automatically when it finishes.";
        return jobResult(job, `Started background job. ${wake}\n${formatJob(job)}`);
      }

      const foreground = registerForegroundJob(job.spec.id);
      let lastOutput = "";
      return watchInline(job.spec.id, async () => {
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
      }, () => job);
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
    description: "List managed background jobs, inspect status or logs, wait for one to finish, stop one safely, force-stop one, restart it with the same command, or clean up old completed jobs.",
    promptSnippet: "Inspect, wait for, and control managed background shell jobs.",
    promptGuidelines: [
      "Use background_jobs for progress, logs, stopping, or restarting a managed_bash job, whether the user asked or a notification requires follow-up.",
      "Use action=wait only for a short dependency you must resolve in the current turn; otherwise end the turn and rely on the automatic completion notification.",
      "Prefer action=stop for graceful shutdown. Use force=true only when graceful shutdown did not finish or the user explicitly requires it.",
    ],
    parameters: Type.Object({
      action: StringEnum(["list", "status", "logs", "wait", "stop", "restart", "cleanup"] as const),
      id: Type.Optional(Type.String({ description: "Managed job id. Required except for list." })),
      lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Number of recent log lines for logs. Defaults to 100." })),
      grace_seconds: Type.Optional(Type.Integer({ minimum: 0, maximum: 120, description: "Graceful stop wait. Defaults to 10 seconds." })),
      force: Type.Optional(Type.Boolean({ description: "After the grace period, force-kill the process tree." })),
      older_than_days: Type.Optional(Type.Integer({ minimum: 1, maximum: 3650, description: "For cleanup, delete terminal jobs older than this many days. Defaults to 14." })),
      timeout_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 3600, description: `For wait, stop waiting after this many seconds; the job keeps running. Defaults to ${DEFAULT_WAIT_SECONDS}.` })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
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
      if (params.action === "wait") {
        const id = params.id;
        const timeoutMs = (params.timeout_seconds ?? DEFAULT_WAIT_SECONDS) * 1_000;
        let waited: ManagedJob | undefined;
        const job = await watchInline(
          id,
          async () => (waited = await waitForManagedJob(id, { timeoutMs, signal })),
          () => waited,
        );
        const output = await readJobOutput(job, MAX_LOG_BYTES);
        const lines = output.split(/\r?\n/).slice(-(params.lines ?? 60)).join("\n");
        const note = isTerminalStatus(job.state.status)
          ? ""
          : "\nStill running when the wait ended; you will be notified automatically when it finishes.";
        return controlJobResult(job, `${formatJob(job)}${note}${lines.trim() ? `\n\n${lines}` : "\n\n(no output yet)"}`);
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
      knownStatuses.set(job.spec.id, "starting");
      void updateUi();
      return controlJobResult(job, `Restarted as a new managed job.\n${formatJob(job)}`);
    },
  });

  pi.registerCommand("jobs", {
    description: "Show managed background jobs, or /jobs <id> [lines] for status plus recent output",
    handler: async (args, ctx) => {
      const [id, linesArg] = args.trim().split(/\s+/).filter(Boolean);
      if (!id) {
        const jobs = (await listManagedJobs()).slice(0, 20);
        ctx.ui.notify(jobs.length === 0 ? "No managed background jobs." : jobs.map(formatJob).join("\n\n"), "info");
        return;
      }
      try {
        const job = await getManagedJob(id);
        const output = await readJobOutput(job, MAX_LOG_BYTES);
        const requested = linesArg ? Number.parseInt(linesArg, 10) : 40;
        const tail = output.split(/\r?\n/).slice(-(Number.isFinite(requested) && requested > 0 ? requested : 40)).join("\n");
        ctx.ui.notify(`${formatJob(job)}${tail.trim() ? `\n\n${tail}` : "\n\n(no output yet)"}`, "info");
      } catch (error) {
        ctx.ui.notify(`No managed job found for id "${id}": ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.on("before_agent_start", (_event, ctx) => {
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
  });

  // A person typing resets the failure wake-up budget; extension-injected input does not.
  pi.on("input", (event) => {
    if (event.source !== "extension") failureWakesSinceInput = 0;
  });

  pi.on("session_start", async (_event, ctx) => {
    sessionContext = ctx;
    editorWrapped = false;
    await pruneManagedJobs(14);
    const jobs = (await listManagedJobs()).filter(
      (job) => job.spec.sessionId === ctx.sessionManager.getSessionId(),
    );
    knownStatuses.clear();
    inlineJobs.clear();
    failureWakesSinceInput = 0;
    for (const job of jobs) knownStatuses.set(job.spec.id, job.state.status);

    // Report jobs that finished while Pi was closed or reloading. They are
    // recorded without starting a turn so opening a session never runs the agent.
    const missed = unreportedTerminalJobs(jobs, reportedJobIds(ctx.sessionManager.getEntries()));
    for (const job of missed) await deliverNotification(ctx, job, true);

    const activeTools = pi.getActiveTools();
    const next = [...new Set([...activeTools, JOB_TOOL, CONTROL_TOOL])];
    if (next.length !== activeTools.length) pi.setActiveTools(next);

    stopPoller();
    await updateUi(); // starts the poller itself if any job for this session is still active
  });

  pi.on("session_shutdown", () => {
    if (sessionContext?.hasUI) sessionContext.ui.setStatus("background-jobs", undefined);
    sessionContext = undefined;
    editorWrapped = false;
    inlineJobs.clear();
    stopPoller();
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

function sanitize(text: string): string {
  return String(text)
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function boundedText(text: string): string {
  const sanitized = sanitize(text);
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

const MAX_STATUS_JOBS = 3;
const MAX_STATUS_TITLE_LEN = 24;

function shortTitle(title: string): string {
  return title.length > MAX_STATUS_TITLE_LEN ? `${title.slice(0, MAX_STATUS_TITLE_LEN - 1)}…` : title;
}

/**
 * Build a compact, single-line footer status describing active managed jobs, e.g.
 * "⚙ 2 background jobs (build 3m12s, review-agent 1m04s)".
 */
function describeActiveJobs(active: ManagedJob[]): string {
  if (active.length === 0) return "";
  const shown = active.slice(0, MAX_STATUS_JOBS).map((job) => {
    const elapsedMs = jobElapsedMs(job);
    const elapsed = elapsedMs !== undefined ? ` ${formatDuration(elapsedMs)}` : "";
    return `${shortTitle(job.spec.title)}${elapsed}`;
  });
  const hidden = active.length - shown.length;
  const suffix = hidden > 0 ? `, +${hidden} more` : "";
  const label = active.length === 1 ? "background job" : "background jobs";
  return `⚙ ${active.length} ${label} (${shown.join(", ")}${suffix})`;
}
