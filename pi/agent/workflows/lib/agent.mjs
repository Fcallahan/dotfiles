// ~/.pi/agent/workflows/lib/agent.mjs
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL_FLAG = "--model"; // verified for this pi build
const DEFAULT_MODEL = process.env.PI_WF_MODEL ?? "deepseek/deepseek-v4-flash";
const CHEAP_MODEL = process.env.PI_WF_CHEAP ?? "deepseek/deepseek-v4-flash";
const DEFAULT_PROVIDER = process.env.PI_WF_PROVIDER ?? "openrouter";

// "opus" (Opus 4.8 alias) is the shipped default smart model. "fable" /
// "claude-fable-5" also works on this subscription (verified against `claude
// --model fable`) — set PI_WF_SMART_MODEL=fable to switch every claude-harness
// role over to it without touching this file.
const SMART_MODEL = process.env.PI_WF_SMART_MODEL ?? "opus";

// The claude CLI binary, resolved via PATH (same as any other spawned tool
// in this lib) rather than hardcoded to an install path so this keeps working
// across `claude` upgrades/reinstalls.
const CLAUDE_BIN = process.env.PI_WF_CLAUDE_BIN ?? "claude";

// --- Claude settings-source isolation ---------------------------------
// `claude -p` children default to loading the user/project/local settings
// sources, which pulls in ~/.claude/CLAUDE.md (this user's global infra
// notes, model-dispatch policy, commit rules, etc.) and its auto-memory into
// every headless subagent. That's irrelevant-to-actively-conflicting context
// for a narrow spawned unit, and it makes the prompt prefix differ per
// machine/user, which defeats provider-side prompt caching.
// Empirically verified against claude 2.1.211 (see workflow report for the
// exact before/after transcripts): `--setting-sources ""` excludes ALL THREE
// sources (user CLAUDE.md + memory, project CLAUDE.md/.claude/settings.json,
// local .claude/settings.local.json) while subscription auth keeps working —
// auth lives under ~/.claude but is credential storage, not a "setting
// source", so it is unaffected by this flag. "" is the narrowest value that
// satisfies "exclude user-level CLAUDE.md" (it excludes everything).
// Escape hatch: PI_WF_CLAUDE_SETTINGS_SOURCES=default|1 skips the isolation
// flag entirely (CLI default sources, i.e. today's un-isolated behavior).
// Any other value is passed through verbatim as the --setting-sources value
// (e.g. "project,local" to keep project-level conventions but still drop the
// user's global CLAUDE.md).
const CLAUDE_SETTINGS_SOURCES_ENV = process.env.PI_WF_CLAUDE_SETTINGS_SOURCES;
function claudeSettingSourcesArgs() {
  if (CLAUDE_SETTINGS_SOURCES_ENV === "default" || CLAUDE_SETTINGS_SOURCES_ENV === "1") return [];
  return ["--setting-sources", CLAUDE_SETTINGS_SOURCES_ENV ?? ""];
}

const GRACE_MS = 5_000;
const FIRST_RESPONSE_MS = Number(process.env.PI_WF_FIRST_RESPONSE_MS ?? 60_000);

// --- Usage accounting & failure diagnostics -----------------------------
// Each child's stdout is NDJSON (pi: `--mode json`; claude: `--output-format
// stream-json --verbose`). Both harnesses' event shapes were probed against
// the installed binaries (pi 0.80.7, claude 2.1.211):
//
// pi: every completed model call emits `{"type":"message_end","message":{
// "role":"assistant","usage":{"input","output","cacheRead","cacheWrite",
// "cost":{"total",...}}}}`. Usage on this event is PER MODEL CALL, not
// cumulative across a multi-turn tool-using run (verified: a 3-turn
// tool-call run emitted 3 separate message_end/assistant events, each with
// its own non-overlapping usage) — so usage is summed across every such
// event seen, not just the last one.
//
// claude: the terminal `{"type":"result",...}` event carries cumulative
// `usage.input_tokens` / `usage.output_tokens` / `usage.cache_read_input_tokens`
// / `usage.cache_creation_input_tokens` and a top-level `total_cost_usd`.
// Only one `result` event is ever emitted per run, so no summing needed.
function addPiUsage(acc, usage) {
  if (!usage) return acc;
  acc.inputTokens = (acc.inputTokens ?? 0) + (usage.input ?? 0);
  acc.outputTokens = (acc.outputTokens ?? 0) + (usage.output ?? 0);
  acc.cacheReadTokens = (acc.cacheReadTokens ?? 0) + (usage.cacheRead ?? 0);
  acc.cacheWriteTokens = (acc.cacheWriteTokens ?? 0) + (usage.cacheWrite ?? 0);
  if (usage.cost?.total != null) acc.costUsd = (acc.costUsd ?? 0) + usage.cost.total;
  return acc;
}

function claudeUsageFromResult(resultEvent) {
  const usage = resultEvent?.usage;
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens,
    costUsd: resultEvent.total_cost_usd,
  };
}

// Small, deliberately extensible list of plausible rate-limit/overload
// markers. Anthropic's API uses `rate_limit_error` (HTTP 429) and
// `overloaded_error` (HTTP 529); the claude CLI's terminal `result` event
// exposes the HTTP status as `api_error_status` when `is_error` is true (see
// probe: `does-not-exist-model` produced `is_error:true, api_error_status:404`
// with `subtype:"success"` — so `subtype` alone is not reliable, and the text
// content plus status code both need checking). Matched against both the
// parsed claude `result` event and the raw stderr tail.
const RATE_LIMIT_MARKERS = [/rate.?limit/i, /usage limit/i, /overloaded/i, /\b429\b/, /\b529\b/];

export function classifyRateLimited(resultEvent, stderrTailText) {
  if (resultEvent) {
    if (resultEvent.api_error_status === 429 || resultEvent.api_error_status === 529) return true;
    if (resultEvent.is_error) {
      const text = `${resultEvent.subtype ?? ""} ${resultEvent.result ?? ""}`;
      if (RATE_LIMIT_MARKERS.some((re) => re.test(text))) return true;
    }
  }
  if (stderrTailText && RATE_LIMIT_MARKERS.some((re) => re.test(stderrTailText))) return true;
  return false;
}

const STDERR_TAIL_MAX = 2048;

// --- Role-based routing ------------------------------------------------------
// Judgment-heavy phases (planning, architecture, review, adversarial
// verification) get the claude harness + smart model. Volume phases
// (scanning, mapping, classification, bulk mechanical work) stay on the pi
// harness + cheap/default model. See SKILL.md for routing guidance.
// planner/architect: lowest-volume, deepest-judgment phases (up-front plan,
// structural decisions) — default to fable, the deepest-reasoning model,
// since low volume makes the cost a non-issue. Fable turns can run many
// minutes, hence the longer per-role timeoutMs (agentForRole's override
// merge below still lets a caller-supplied timeoutMs win — see spawnAgent).
// verifier: highest-volume judgment phase (adversarial verification across
// many candidates) — defaults to sonnet: near-opus judgment quality for this
// kind of confirm/refute work, cheaper and drawing from a separate rate-limit
// window than fable/opus, so wide verifier fan-outs don't compete with
// planner/architect/reviewer for the same subscription budget.
export const ROLES = {
  planner:    { harness: "claude", model: process.env.PI_WF_PLANNER_MODEL   ?? "fable", timeoutMs: 30 * 60_000 },
  architect:  { harness: "claude", model: process.env.PI_WF_ARCHITECT_MODEL ?? "fable", timeoutMs: 30 * 60_000 },
  reviewer:   { harness: "claude", model: process.env.PI_WF_REVIEWER_MODEL  ?? SMART_MODEL },
  verifier:   { harness: "claude", model: process.env.PI_WF_VERIFIER_MODEL  ?? "sonnet" },
  scout:      { harness: "pi", model: CHEAP_MODEL },
  mapper:     { harness: "pi", model: CHEAP_MODEL },
  classifier: { harness: "pi", model: CHEAP_MODEL },
  worker:     { harness: "pi", model: DEFAULT_MODEL },
};

// Merge a role's defaults under explicit overrides (overrides win). Unknown
// roles fall back to "worker" rather than throwing, since a typo'd role
// shouldn't crash a long fan-out — it just degrades to the default pi worker.
export function agentForRole(role, overrides = {}) {
  const base = ROLES[role] ?? ROLES.worker;
  return { ...base, ...overrides };
}

function withArtifactWriteTool(tools) {
  const list = String(tools || "").split(",").map((t) => t.trim()).filter(Boolean);
  if (!list.includes("write")) list.push("write");
  return list.join(",");
}

// Map this lib's pi-style tool names (read,bash,edit,write,...) to claude
// CLI's --allowedTools names. Write is always included (the artifact
// contract requires it) even if the caller's tool list omitted it —
// withArtifactWriteTool() above already guarantees that for the pi harness,
// so we run the same normalization first.
const PI_TO_CLAUDE_TOOL = {
  read: "Read",
  bash: "Bash",
  edit: "Edit",
  write: "Write",
  grep: "Grep",
  find: "Glob",
  ls: "Glob",
};
function toClaudeAllowedTools(tools) {
  const piTools = withArtifactWriteTool(tools).split(",").map((t) => t.trim()).filter(Boolean);
  const claudeTools = new Set();
  for (const t of piTools) {
    const mapped = PI_TO_CLAUDE_TOOL[t.toLowerCase()];
    claudeTools.add(mapped ?? t);
  }
  claudeTools.add("Write"); // belt-and-suspenders: artifact contract is non-negotiable.
  return [...claudeTools].join(",");
}

// --- Claude concurrency guard -------------------------------------------
// Subscription rate windows make wide claude fan-outs expensive (and slow —
// they queue behind each other server-side anyway), so cap how many claude
// children this process runs at once. Simple promise-queue semaphore; the pi
// harness is untouched by this and keeps using its existing concurrency
// (mapLimit/runUnits) unbounded by this guard.
const CLAUDE_CONCURRENCY = Math.max(1, Number(process.env.PI_WF_CLAUDE_CONCURRENCY ?? 3));
let claudeActive = 0;
const claudeWaiters = [];
function acquireClaudeSlot() {
  if (claudeActive < CLAUDE_CONCURRENCY) {
    claudeActive++;
    return Promise.resolve(releaseClaudeSlot);
  }
  return new Promise((resolve) => {
    claudeWaiters.push(() => {
      claudeActive++;
      resolve(releaseClaudeSlot);
    });
  });
}
function releaseClaudeSlot() {
  claudeActive--;
  const next = claudeWaiters.shift();
  if (next) next();
}

// SIGTERM first, then SIGKILL after a grace period if the process hasn't exited.
function killGracefully(p) {
  try { p.kill("SIGTERM"); } catch {}
  const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} }, GRACE_MS);
  t.unref?.();
  return t;
}

// --- Cooperative shutdown wiring -------------------------------------------
// Children are spawned NON-detached deliberately: the dynamic-workflow-ux
// extension's process-group kill (process.kill(-pid)) and a terminal Ctrl-C
// both rely on this process and its children sharing a process group. Do not
// add `detached: true` here.
const activeChildren = new Set();
const shutdownController = new AbortController();
export const workflowSignal = shutdownController.signal;

let handlersInstalled = false;
function installSignalHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      if (shutdownController.signal.aborted) process.exit(sig === "SIGINT" ? 130 : 143);
      shutdownController.abort(new Error(`received ${sig}`));
      // Set the exit code up front: if remaining work drains naturally before
      // the grace timer below fires (e.g. no children were in flight, or they
      // died immediately), the process would otherwise exit 0 via normal
      // event-loop drain instead of signaling that it was interrupted.
      process.exitCode = sig === "SIGINT" ? 130 : 143;
      for (const child of activeChildren) { try { child.kill("SIGTERM"); } catch {} }
      const t = setTimeout(() => {
        for (const child of activeChildren) { try { child.kill("SIGKILL"); } catch {} }
        process.exit(sig === "SIGINT" ? 130 : 143);
      }, GRACE_MS);
      t.unref();
    });
  }
}

// Spawn one isolated headless subagent, pi or claude. Resolves { ok, result, code, ... }.
async function runSpawnAgent({
  prompt,
  harness = "pi",
  model = harness === "claude" ? SMART_MODEL : DEFAULT_MODEL,
  tools = "read,bash,edit,write",
  cwd = process.cwd(),
  appendSystemPrompt,
  timeoutMs = 15 * 60_000,
  outputContract = '{ "summary": string, "findings": array, "confidence": number }',
  signal = workflowSignal,
  // `provider` is a pi-only concept (openrouter/etc routing) — claude auth is
  // subscription-based, so this is silently ignored for the claude harness.
  provider = DEFAULT_PROVIDER,
}) {
  if (signal.aborted) {
    return { ok: false, result: null, code: null, aborted: true };
  }

  let releaseSlot;
  if (harness === "claude") {
    releaseSlot = await acquireClaudeSlot();
    if (signal.aborted) {
      releaseSlot();
      return { ok: false, result: null, code: null, aborted: true };
    }
  }

  try {
    const dir = await mkdtemp(join(tmpdir(), "pi-wf-"));
    const promptPath = join(dir, "prompt.md");
    const systemAppendPath = join(dir, "system-append.md");
    const outPath = join(dir, "out.json");

    // --- Cache-friendly prompt assembly -------------------------------------
    // Byte-identical-across-units content goes first/on the system side;
    // unique-per-unit content (the outPath) goes last. Two units in the same
    // runUnits() phase share the same outputContract and (usually) the same
    // caller-provided appendSystemPrompt, so the merged system-prompt text
    // below is byte-identical across those units — that's what lets
    // Anthropic/OpenRouter/deepseek prompt caching hit on the shared prefix.
    // Putting the volatile outPath in the middle of the old single blob (and
    // the unit prompt first) meant NO two units ever shared a byte-identical
    // prefix; this split fixes that for both harnesses.

    // Static, phase-stable contract text: no outPath, no unit-specific
    // content. This is what makes it safe to merge into --append-system-prompt.
    const contractText = `When finished, use the write tool to save a single JSON object to the exact path given at the very end of your task prompt.
Do not print the JSON to stdout.
Do not write anywhere else unless the task explicitly asks you to modify project files.
Required shape: ${outputContract}`;

    // Resolve the caller's appendSystemPrompt (by convention a file path, but
    // tolerate literal text too — same fallback the claude branch used to do
    // only for itself) so it can be concatenated with the contract text
    // above. Caller content comes first, contract text is appended after.
    const callerSystemText = appendSystemPrompt
      ? await readFile(appendSystemPrompt, "utf8").catch(() => String(appendSystemPrompt))
      : "";
    const mergedSystemPrompt = callerSystemText ? `${callerSystemText}\n\n${contractText}` : contractText;
    await writeFile(systemAppendPath, mergedSystemPrompt, "utf8");

    // User-side prompt: caller's actual unit prompt FIRST, unique outPath
    // line at the VERY END. Nothing unique-per-unit before the caller's text.
    const framed = `${prompt}

---
Write your JSON result to this exact path: ${outPath}`;

    // Written for human debugging in both harnesses; also the actual prompt
    // source for the pi harness (`-p @promptPath` below). The claude harness
    // now feeds this same text over stdin (see Task 3) rather than argv or
    // `@path`, so this file is inspection-only for that harness.
    await writeFile(promptPath, framed, "utf8");

    let cmd, args, env;
    if (harness === "claude") {
      cmd = CLAUDE_BIN;
      args = [
        "-p", // no argv prompt text: fed over stdin instead (see spawn below).
        // Verified against claude 2.1.211: `echo "..." | claude -p
        // --output-format json --model haiku` works with -p taking no
        // argument when stdin is piped. This avoids putting the (potentially
        // large) framed prompt in argv, which is visible via `ps` and subject
        // to the OS argv size limit (~2MB).
        "--output-format", "stream-json", // NDJSON so the first-stdout-byte watchdog below
        // stays meaningful; plain `--output-format json` only prints once, at the very end.
        "--verbose", // stream-json emits richer per-event detail with this on;
        // doesn't change whether the watchdog/artifact contract works.
        "--dangerously-skip-permissions", // headless tool use has no TTY to approve
        // prompts from; same trade-off the subagents extension makes for
        // bypassPermissions (see extensions/subagents/docs/design-plan.md).
        "--model", model,
        "--allowedTools", toClaudeAllowedTools(tools),
        ...claudeSettingSourcesArgs(), // isolate from ~/.claude/CLAUDE.md; see const above.
        // claude's --append-system-prompt takes inline text directly (unlike
        // pi's `-p`, there's no `@file` round trip needed here), so just pass
        // the merged text we already have in memory.
        "--append-system-prompt", mergedSystemPrompt,
      ];
      env = { ...process.env };
      // Node's permission-model sandbox (the dynamic-workflow-ux extension)
      // propagates its --permission/--allow-* flags to child *node* processes
      // via NODE_OPTIONS by design. `claude` is itself a Node/Bun program, so
      // it would otherwise inherit a sandbox meant for the pi workflow's own
      // cwd/tmp/workflows-dir needs — wrong shape for claude's own state dirs
      // (~/.claude) and liable to make it fail outright. Strip it, the same
      // way @anthropic-ai/claude-agent-sdk does before spawning `claude`.
      delete env.NODE_OPTIONS;
      // Deliberately do NOT set PI_OFFLINE here — that's a pi-only env knob.
    } else {
      cmd = "pi";
      args = [
        MODEL_FLAG, model,
        "--provider", provider,
        "--no-session",
        "--mode", "json",
        "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
        "--offline",
        "--tools", withArtifactWriteTool(tools),
        "-p", `@${promptPath}`,
        "--append-system-prompt", `@${systemAppendPath}`,
      ];
      env = { ...process.env, PI_OFFLINE: "1" };
    }

    let timedOut = false;
    let watchdogTimeout = false;
    let sawOutput = false;

    // Line-buffered NDJSON accumulation across both harnesses (see the
    // "Usage accounting & failure diagnostics" section above for the event
    // shapes). Unparseable lines are ignored — a partial line at the end of
    // a chunk is carried over to the next chunk, not parsed prematurely.
    let stdoutBuffer = "";
    const piUsageAcc = {};
    let claudeResultEvent = null;
    let stderrTail = "";

    const code = await new Promise((resolve) => {
      let settled = false;
      let abortListener;
      const finish = (c) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        clearTimeout(watchdogTimer);
        if (abortListener) signal.removeEventListener("abort", abortListener);
        resolve(c);
      };

      // claude harness reads the framed prompt over stdin (Task 3); pi harness
      // is unchanged and keeps using `@promptPath` (no stdin needed), so its
      // stdin stays "ignore" exactly as before.
      const p = spawn(cmd, args, { cwd, env, stdio: harness === "claude" ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"] });
      activeChildren.add(p);

      if (harness === "claude") {
        p.stdin.write(framed);
        p.stdin.end();
      }

      const killTimer = setTimeout(() => { timedOut = true; killGracefully(p); }, timeoutMs);

      let watchdogTimer;
      if (FIRST_RESPONSE_MS > 0) {
        watchdogTimer = setTimeout(() => { watchdogTimeout = true; killGracefully(p); }, FIRST_RESPONSE_MS);
      }

      p.stdout.on("data", (chunk) => {
        // The real answer is read from the artifact, not stdout — but the
        // stream still carries per-call usage/cost that only exists while
        // the child is alive, so it's parsed here as NDJSON rather than
        // fully drained/ignored.
        if (!sawOutput) {
          sawOutput = true;
          clearTimeout(watchdogTimer);
        }
        stdoutBuffer += chunk.toString("utf8");
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? ""; // keep the trailing partial line for next chunk
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let evt;
          try {
            evt = JSON.parse(trimmed);
          } catch {
            continue; // ignore unparseable lines (partial/non-JSON output)
          }
          if (harness === "pi") {
            if (evt?.type === "message_end" && evt.message?.role === "assistant" && evt.message?.usage) {
              addPiUsage(piUsageAcc, evt.message.usage);
            }
          } else if (harness === "claude") {
            if (evt?.type === "result") claudeResultEvent = evt;
          }
        }
      });
      p.stderr.on("data", (chunk) => {
        stderrTail = (stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_MAX);
      });

      abortListener = () => { killGracefully(p); };
      signal.addEventListener("abort", abortListener);

      p.on("error", () => finish(-1));
      p.on("close", (c) => {
        activeChildren.delete(p);
        finish(c);
      });
    });

    // usage is reported on both success and failure returns (whatever was
    // accumulated before the child exited/was killed); stderrTail is
    // failure-only diagnostics, omitted on success.
    const usage = harness === "claude" ? claudeUsageFromResult(claudeResultEvent) : (Object.keys(piUsageAcc).length ? { ...piUsageAcc } : undefined);
    const rateLimited = harness === "claude" ? classifyRateLimited(claudeResultEvent, stderrTail) : undefined;

    if (watchdogTimeout) {
      return {
        ok: false, result: null, code, workDir: dir, promptPath, outPath, aborted: signal.aborted, watchdogTimeout: true,
        usage, stderrTail, ...(rateLimited ? { rateLimited } : {}),
      };
    }

    try {
      const result = JSON.parse(await readFile(outPath, "utf8"));
      if (process.env.PI_WF_KEEP_TMP !== "1") {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
      return { ok: true, result, code, workDir: dir, promptPath, outPath, cleaned: true, usage };
    } catch {
      // Keep dir on failure for debugging.
      return {
        ok: false, result: null, code, workDir: dir, promptPath, outPath, aborted: signal.aborted, timedOut,
        usage, stderrTail, ...(rateLimited ? { rateLimited } : {}),
      };
    }
  } finally {
    if (releaseSlot) releaseSlot();
  }
}

// --- Unawaited-call detection (lazy thenable) --------------------------------
// spawnAgent() itself does NOT start the subprocess; the spawn only happens
// once the returned thenable is awaited/`.then`'d/etc. This is intentional:
// it lets us detect "fire and forget" spawnAgent(...) calls that a worker
// forgot to `await`/`return` (which would otherwise silently never run) and
// warn (or, with PI_WF_STRICT_AWAIT=1, fail the process) at exit.
const unawaited = new Set();

export function spawnAgent(options = {}) {
  installSignalHandlers();
  // `role` is a shorthand for `{ ...agentForRole(role) }`: it fills in
  // harness/model defaults for the role, but any harness/model the caller
  // passed explicitly still wins (agentForRole spreads overrides last).
  const effective = options.role ? agentForRole(options.role, options) : options;
  const record = { label: String(effective.prompt ?? "").slice(0, 80), stack: new Error("spawnAgent created here").stack };
  unawaited.add(record);
  let promise;
  const start = () => {
    if (!promise) {
      unawaited.delete(record);
      promise = runSpawnAgent(effective);
    }
    return promise;
  };
  return {
    then: (f, r) => start().then(f, r),
    catch: (r) => start().catch(r),
    finally: (f) => start().finally(f),
  };
}

process.on("beforeExit", () => {
  if (!unawaited.size) return;
  console.error(`[workflows] WARNING: ${unawaited.size} spawnAgent(...) call(s) created but never awaited (they never ran):`);
  for (const r of unawaited) console.error(`  - "${r.label}"\n    ${r.stack.split("\n")[2]?.trim() ?? ""}`);
  if (process.env.PI_WF_STRICT_AWAIT === "1") process.exitCode = 1;
});

// Bounded parallelism — keep local resources under control.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

export { CHEAP_MODEL, SMART_MODEL };
