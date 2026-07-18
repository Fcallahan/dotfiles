// ~/.pi/agent/workflows/lib/runtime.mjs
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { agentForRole, mapLimit, preflight, workflowSignal } from "./agent.mjs";

export function parseWorkflowArgs(argv = process.argv.slice(2)) {
  const out = { positionals: [], resume: true, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--resume") out.resume = true;
    else if (arg === "--no-resume") out.resume = false;
    else if (arg === "--force" || arg === "--fresh") out.force = true;
    else if (arg === "--retries") out.retries = Number(argv[++i]);
    else if (arg.startsWith("--retries=")) out.retries = Number(arg.slice("--retries=".length));
    else if (arg === "--concurrency") out.concurrency = Number(argv[++i]);
    else if (arg.startsWith("--concurrency=")) out.concurrency = Number(arg.slice("--concurrency=".length));
    else out.positionals.push(arg);
  }
  return out;
}

export function slugify(value, fallback = "item") {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

export function hash(value, length = 12) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

export async function fileFingerprint(path) {
  try {
    const buf = await readFile(path);
    return `sha256:${createHash("sha256").update(buf).digest("hex")}`;
  } catch (err) {
    return `missing:${err?.code ?? "error"}`;
  }
}

export function requireJsonFields(shape) {
  return (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "result must be an object";
    const errors = [];
    for (const [field, expected] of Object.entries(shape)) {
      const actual = Array.isArray(value[field]) ? "array" : value[field] === null ? "null" : typeof value[field];
      const allowed = Array.isArray(expected) ? expected : [expected];
      if (!allowed.includes(actual)) errors.push(`${field} must be ${allowed.join("|")} (got ${actual})`);
    }
    return errors.length ? errors.join("; ") : true;
  };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

// Durable NDJSON append: opens in append mode, writes, fsyncs, closes. Used
// for the run's events log and eager checkpoint file (see runUnits' eventsPath
// / checkpointPath below) — both need to survive the orchestrator process
// being killed mid-run, so a plain fs.appendFile (which only guarantees the
// write left this process, not that it's actually on disk) isn't enough.
// Concurrent callers are safe: each write is a single small O_APPEND write()
// syscall, which POSIX guarantees is atomic against interleaving on a local
// filesystem.
async function appendNdjson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const line = `${JSON.stringify({ ts: new Date().toISOString(), ...value })}\n`;
  const handle = await open(path, "a");
  try {
    await handle.appendFile(line, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// --- Dead-run detector -----------------------------------------------------
// A child can exit 0 having produced almost nothing (observed: 34 tokens,
// "I'll analyze...", then stopped) — a distinct failure mode from a normal
// ok/failed result that used to get swallowed by a silent manual retry,
// making run counts ambiguous. "Near-empty" is measured on the serialized
// result JSON (what callers actually consume via the artifact), not raw
// stdout. Exported so it can be unit-tested directly.
const DEAD_RUN_MIN_CHARS = 200;
export function classifyDeadRun(result) {
  if (result == null) return true;
  const text = typeof result === "string" ? result : JSON.stringify(result);
  return text.length < DEAD_RUN_MIN_CHARS;
}

// Cap on how much of a unit's output text lands in checkpoint.ndjson per
// entry, so one outsized result can't blow up the checkpoint file.
const CHECKPOINT_OUTPUT_MAX_CHARS = 20_000;

function defaultUnitKey(unit) {
  if (typeof unit === "string" || typeof unit === "number" || typeof unit === "boolean") return String(unit);
  if (unit && typeof unit === "object") return String(unit.id ?? unit.key ?? unit.path ?? unit.file ?? stableStringify(unit));
  return String(unit);
}

function defaultUnitLabel(unit) {
  if (typeof unit === "string" || typeof unit === "number" || typeof unit === "boolean") return String(unit);
  if (unit && typeof unit === "object") return String(unit.label ?? unit.path ?? unit.file ?? unit.id ?? unit.key ?? "unit");
  return String(unit);
}

function validationError(validate, result) {
  if (!validate) return null;
  const validator = typeof validate === "function" ? validate : requireJsonFields(validate);
  const verdict = validator(result);
  if (verdict === true || verdict == null) return null;
  if (verdict === false) return "validation failed";
  if (Array.isArray(verdict)) return verdict.join("; ");
  return String(verdict);
}

function normalizeWorkerResult(raw) {
  if (raw && typeof raw === "object" && Object.hasOwn(raw, "ok") && (Object.hasOwn(raw, "result") || Object.hasOwn(raw, "code"))) {
    const meta = {
      workDir: raw.workDir,
      promptPath: raw.promptPath,
      outPath: raw.outPath,
    };
    // Surface spawnAgent()'s failure-classification flags, usage accounting,
    // and failure diagnostics (when present) so they're visible on the
    // manifest entry instead of only in-memory. `usage` and `stderrTail`
    // aren't booleans but the same "copy if present" pass-through applies.
    // durationWallMs/durationMonoMs/hardWatchdogTripped and the preflight*
    // fields follow the same pattern (see agent.mjs's hard watchdog and
    // preflight gate).
    for (const flag of [
      "aborted", "watchdogTimeout", "timedOut", "cleaned", "rateLimited", "usage", "stderrTail",
      "durationWallMs", "durationMonoMs", "hardWatchdogTripped",
      "preflightFailed", "preflightReason", "preflightChecks",
    ]) {
      if (Object.hasOwn(raw, flag)) meta[flag] = raw[flag];
    }
    return { ok: Boolean(raw.ok), result: raw.result, code: raw.code, meta };
  }
  return { ok: true, result: raw, code: undefined, meta: undefined };
}

// How long to wait before retrying a claude-harness unit that failed with a
// detected rate-limit/overload condition (classifyRateLimited() in agent.mjs),
// instead of the normal retryDelayMs. Honors signal abort during the wait
// (see sleepAbortable below) so Ctrl-C still exits promptly mid-backoff.
const RATELIMIT_BACKOFF_MS = Number(process.env.PI_WF_RATELIMIT_BACKOFF_MS ?? 60_000);

// Cap on free (non-retry-budget-consuming) rate-limit waits per unit, to
// prevent a persistently rate-limited unit from waiting forever across an
// unbounded number of "free" passes.
const RATELIMIT_MAX_FREE_WAITS = 3;

function sleepAbortable(ms, signal) {
  return new Promise((resolveSleep) => {
    if (signal.aborted) {
      resolveSleep();
      return;
    }
    const t = setTimeout(cleanup, ms);
    const onAbort = () => cleanup();
    function cleanup() {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
      resolveSleep();
    }
    signal.addEventListener("abort", onAbort);
  });
}

// Usage accounting: same shape as spawnAgent()'s per-unit `usage` ({
// inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd }),
// summed in place onto an accumulator (e.g. manifest.totalUsage).
function accumulateUsage(acc, usage) {
  if (!usage) return acc;
  for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "costUsd"]) {
    if (usage[field] != null) acc[field] = (acc[field] ?? 0) + usage[field];
  }
  return acc;
}

function totalTokensOf(usage) {
  if (!usage) return 0;
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

function countStatuses(units) {
  const counts = { total: units.length, done: 0, failed: 0, pending: 0, running: 0 };
  for (const entry of units) {
    if (counts[entry.status] == null) counts[entry.status] = 0;
    counts[entry.status]++;
  }
  return counts;
}

// Resumable, retryable fan-out. Worker may return spawnAgent(...) or a plain JSON result.
export async function runUnits({
  name,
  task = "",
  units,
  worker,
  concurrency = 16,
  retries = 2,
  resume = true,
  force = false,
  runDir,
  unitKey = defaultUnitKey,
  unitLabel = defaultUnitLabel,
  fingerprint,
  validate,
  retryDelayMs = 0,
  signal = workflowSignal,
  warmStart = false,
  maxCostUsd,
  maxTotalTokens,
  escalate,
  // The cwd workers actually dispatch subprocesses into (matches
  // spawnAgent()'s own default) — used only for the preflight gate below;
  // does not change where any worker's own spawnAgent({ cwd }) runs.
  cwd = process.cwd(),
} = {}) {
  if (!name) throw new Error("runUnits requires name");
  if (!Array.isArray(units)) throw new Error("runUnits requires units array");
  if (typeof worker !== "function") throw new Error("runUnits requires worker function");

  // --- Retry escalation ladder -------------------------------------------
  // `escalate` is either a role name (resolved via agentForRole from
  // agent.mjs) or a plain object of spawnAgent overrides. Resolved once,
  // up front, into the exact overrides object a unit's FINAL attempt will
  // see on its worker ctx — no per-attempt ladder, just "last attempt gets
  // this one bump."
  const escalationOverrides = escalate == null
    ? undefined
    : typeof escalate === "string"
      ? agentForRole(escalate)
      : escalate;

  const runDirAbs = resolve(runDir ?? join(process.cwd(), ".pi", "workflows", "runs", slugify(name, "workflow")));
  const manifestPath = join(runDirAbs, "manifest.json");
  const eventsPath = join(runDirAbs, "events.ndjson");
  const checkpointPath = join(runDirAbs, "checkpoint.ndjson");
  await mkdir(join(runDirAbs, "units"), { recursive: true });

  const now = new Date().toISOString();

  // --- Preflight gate ------------------------------------------------------
  // Runs once, up front, before a single unit/worker/subprocess for this run
  // starts (agent.mjs's preflightCached also memoizes per-cwd across
  // spawnAgent() calls — this is what lets a failing preflight short-circuit
  // the ENTIRE run here instead of every unit independently discovering and
  // failing on the same condition). See agent.mjs's preflight() for what's
  // checked (git work tree, free disk, $HOME sanity).
  const preflightResult = await preflight(cwd);
  if (!preflightResult.ok) {
    await appendNdjson(eventsPath, {
      type: "preflight_failed", name, cwd: preflightResult.cwd, reason: preflightResult.reason, checks: preflightResult.checks,
    });
    const failedManifest = {
      schemaVersion: 1,
      invocationId: process.env.PI_DYNAMIC_WORKFLOW_RUN_ID,
      name,
      task,
      runDir: runDirAbs,
      createdAt: now,
      updatedAt: now,
      status: "preflight_failed",
      preflight: preflightResult,
      totalUsage: {},
      options: { concurrency, retries, resume, force, maxCostUsd, maxTotalTokens },
      units: {},
      counts: { total: units.length, done: 0, failed: 0, pending: 0, running: 0, preflight_failed: units.length },
    };
    await writeJsonAtomic(manifestPath, failedManifest);
    return {
      name,
      runDir: runDirAbs,
      manifestPath,
      manifest: failedManifest,
      units: [],
      results: [],
      done: [],
      failed: [],
      skipped: [],
      counts: failedManifest.counts,
      totalUsage: failedManifest.totalUsage,
      preflightFailed: true,
      preflight: preflightResult,
    };
  }

  const loaded = force ? undefined : await readJson(manifestPath);
  const manifest = {
    schemaVersion: 1,
    invocationId: process.env.PI_DYNAMIC_WORKFLOW_RUN_ID,
    name,
    task,
    runDir: runDirAbs,
    createdAt: loaded?.createdAt ?? now,
    // Carried forward across resumes so a budget ceiling reflects cumulative
    // spend across the whole run's history, not just this invocation.
    totalUsage: loaded?.totalUsage ? { ...loaded.totalUsage } : {},
    updatedAt: now,
    options: { concurrency, retries, resume, force, maxCostUsd, maxTotalTokens },
    units: {},
    counts: { total: units.length, done: 0, failed: 0, pending: units.length, running: 0 },
  };

  const seen = new Map();
  const metas = [];
  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    const baseKey = String(unitKey(unit, index));
    const seenCount = seen.get(baseKey) ?? 0;
    seen.set(baseKey, seenCount + 1);
    const key = seenCount ? `${baseKey}#${seenCount}` : baseKey;
    const label = String(unitLabel(unit, index));
    const currentFingerprint = fingerprint ? await fingerprint(unit, index) : undefined;
    const old = loaded?.units?.[key];
    const reusable = old && !force && resume && old.fingerprint === currentFingerprint;
    const artifact = reusable && old.artifact
      ? old.artifact
      : join(runDirAbs, "units", `${String(index + 1).padStart(4, "0")}-${slugify(label)}-${hash(key)}.json`);
    const entry = reusable
      ? { ...old, status: old.status === "running" ? "pending" : old.status, artifact }
      : { key, index, label, status: "pending", attempts: 0, artifact, fingerprint: currentFingerprint, createdAt: now };
    entry.updatedAt = now;
    manifest.units[key] = entry;
    metas.push({ key, index, label, unit, entry });
  }

  let saveQueue = Promise.resolve();
  const saveManifest = () => {
    manifest.updatedAt = new Date().toISOString();
    manifest.counts = countStatuses(Object.values(manifest.units));
    saveQueue = saveQueue.catch(() => {}).then(() => writeJsonAtomic(manifestPath, manifest));
    return saveQueue;
  };
  await saveManifest();

  const maxAttempts = Math.max(1, Number(retries) + 1);
  const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

  // --- Budget ceiling --------------------------------------------------
  // Tripped at most once (per invocation); after that, processUnit() below
  // short-circuits any unit it hasn't already started, leaving it "pending"
  // with skippedReason "budget_exceeded" instead of failed — a resumed run
  // with a higher maxCostUsd/maxTotalTokens picks those units back up.
  // In-flight units (already past this check when the trip happens) run to
  // completion; mapLimit only calls processUnit once per unit, so there's no
  // re-check mid-flight to abort them early.
  let budgetTripped = false;
  function checkBudget() {
    if (budgetTripped) return;
    const overCost = maxCostUsd != null && (manifest.totalUsage.costUsd ?? 0) >= maxCostUsd;
    const overTokens = maxTotalTokens != null && totalTokensOf(manifest.totalUsage) >= maxTotalTokens;
    if (!overCost && !overTokens) return;
    budgetTripped = true;
    console.error(
      `[workflows] Budget ceiling reached for "${name}": ` +
      `cost=$${(manifest.totalUsage.costUsd ?? 0).toFixed(6)}${maxCostUsd != null ? ` (max $${maxCostUsd})` : ""}, ` +
      `tokens=${totalTokensOf(manifest.totalUsage)}${maxTotalTokens != null ? ` (max ${maxTotalTokens})` : ""} — ` +
      `pausing new unit starts; in-flight units will finish; remaining units stay pending for a resumed run.`
    );
  }

  async function processUnit(meta) {
    const { key, unit, entry } = meta;

    if (resume && !force && entry.status === "done" && await exists(entry.artifact)) {
      const stored = await readJson(entry.artifact);
      const err = validationError(validate, stored);
      if (!err) return { ...meta, status: "done", skipped: true, result: stored, artifact: entry.artifact, attempts: entry.attempts };
      entry.status = "pending";
      entry.error = `stored artifact invalid: ${err}`;
      await saveManifest();
    }

    if (!resume || force) {
      entry.status = "pending";
      entry.attempts = 0;
      delete entry.error;
      delete entry.rateLimitWaits;
      delete entry.deadRunRetried;
      await saveManifest();
    }

    if (budgetTripped) {
      entry.status = "pending";
      entry.skippedReason = "budget_exceeded";
      entry.updatedAt = new Date().toISOString();
      await saveManifest();
      return { ...meta, status: "pending", skipped: false, result: null, artifact: entry.artifact, attempts: entry.attempts, skippedReason: "budget_exceeded" };
    }

    delete entry.skippedReason; // clear any stale budget_exceeded note from a prior capped run

    while (entry.attempts < maxAttempts && !signal.aborted) {
      entry.status = "running";
      entry.attempts++;
      entry.startedAt = new Date().toISOString();
      entry.updatedAt = entry.startedAt;
      delete entry.error;
      // Escalate only on the unit's final allowed attempt (this one, if it
      // fails, exhausts the retry budget). Non-final attempts get
      // ctx.overrides === undefined, unchanged from before this feature.
      const isFinalAttempt = entry.attempts === maxAttempts;
      const overrides = isFinalAttempt && escalationOverrides ? escalationOverrides : undefined;
      if (overrides) entry.escalated = true;
      await saveManifest();

      let normalized;
      try {
        const raw = await worker(unit, { key, entry, attempt: entry.attempts, artifact: entry.artifact, index: entry.index, signal, overrides });
        normalized = normalizeWorkerResult(raw);
        entry.code = normalized.code;
        if (normalized.meta) entry.worker = normalized.meta;
        // Usage is accounted for on both success and failure results (a
        // failed/timed-out/rate-limited attempt can still have burned real
        // tokens/cost), so this runs before the ok-check below can throw.
        accumulateUsage(manifest.totalUsage, normalized.meta?.usage);
        if (!normalized.ok) throw new Error(`worker returned ok=false code=${normalized.code ?? "unknown"}`);
        const err = validationError(validate, normalized.result);
        if (err) throw new Error(`result validation failed: ${err}`);

        // --- Dead-run detector ---------------------------------------------
        // Child exited ok and passed schema validation, but produced
        // near-nothing (see classifyDeadRun above — e.g. 34 tokens then
        // silence). First occurrence per unit gets exactly one free retry
        // (doesn't consume the configured retry budget — same "free pass"
        // shape as the rate-limit branch below); a second dead run in a row
        // is accepted as terminal but stays tagged 'dead_run' rather than
        // silently reported as 'done', so run counts stay unambiguous.
        const deadRun = classifyDeadRun(normalized.result);
        if (deadRun && !entry.deadRunRetried) {
          entry.deadRunRetried = true;
          entry.updatedAt = new Date().toISOString();
          await appendNdjson(eventsPath, {
            type: "dead_run", name, unit: key, label: entry.label, attempt: entry.attempts,
            outputChars: JSON.stringify(normalized.result ?? "").length, artifact: entry.artifact, retrying: true,
          });
          entry.status = "pending";
          entry.attempts--; // free retry — see rate-limit branch below for the same pattern
          await saveManifest();
          continue;
        }

        await writeJsonAtomic(entry.artifact, normalized.result);
        entry.status = deadRun ? "dead_run" : "done";
        entry.finishedAt = new Date().toISOString();
        entry.updatedAt = entry.finishedAt;
        delete entry.error;
        await saveManifest();
        if (deadRun) {
          await appendNdjson(eventsPath, {
            type: "dead_run", name, unit: key, label: entry.label, attempt: entry.attempts,
            outputChars: JSON.stringify(normalized.result ?? "").length, artifact: entry.artifact, retrying: false,
          });
        }

        // --- Eager checkpoint -----------------------------------------------
        // Appended synchronously (fsync'd — see appendNdjson) the moment THIS
        // unit finishes, not batched to the end of the whole run: a
        // session-limit/rate-limit death mid-run has previously destroyed
        // 100% of a run's completed results because nothing was persisted
        // incrementally.
        await appendNdjson(checkpointPath, {
          run: name,
          unit: key,
          agent: entry.label,
          task: String(task ?? "").slice(0, 150),
          status: entry.status,
          code: normalized.code,
          attempts: entry.attempts,
          artifact: entry.artifact,
          output: (typeof normalized.result === "string" ? normalized.result : JSON.stringify(normalized.result)).slice(0, CHECKPOINT_OUTPUT_MAX_CHARS),
        });

        checkBudget();
        return { ...meta, status: entry.status, skipped: false, result: normalized.result, code: normalized.code, artifact: entry.artifact, attempts: entry.attempts };
      } catch (err) {
        entry.error = err?.stack || err?.message || String(err);
        entry.updatedAt = new Date().toISOString();
        if (signal.aborted) {
          // Aborted attempt doesn't count against the retry budget; leave the
          // unit pending so a resumed run picks it back up.
          entry.status = "pending";
          entry.attempts--;
          await saveManifest();
          break;
        }

        const rateLimited = Boolean(normalized?.meta?.rateLimited);
        if (rateLimited && (entry.rateLimitWaits ?? 0) < RATELIMIT_MAX_FREE_WAITS) {
          // Free pass: wait the rate-limit backoff instead of the normal
          // retryDelayMs, and don't count this attempt against the retry
          // budget — mirrors the aborted-attempt pattern above. Capped at
          // RATELIMIT_MAX_FREE_WAITS per unit so a persistently rate-limited
          // unit can't wait forever.
          entry.rateLimitWaits = (entry.rateLimitWaits ?? 0) + 1;
          entry.status = "pending";
          entry.attempts--;
          await saveManifest();
          await sleepAbortable(RATELIMIT_BACKOFF_MS, signal);
          if (signal.aborted) break;
          continue;
        }

        entry.status = "failed";
        await saveManifest();
        if (entry.attempts < maxAttempts && retryDelayMs > 0) await sleep(retryDelayMs);
      }
    }

    checkBudget();
    return { ...meta, status: entry.status, skipped: false, result: null, code: entry.code, error: entry.error, artifact: entry.artifact, attempts: entry.attempts };
  }

  // --- warmStart -----------------------------------------------------------
  // A fully-parallel fan-out start means every unit's first request races to
  // populate the provider-side prompt cache for their shared prefix at the
  // same instant — none of them can read a cache entry a concurrent sibling
  // is still in the middle of writing, so the whole first wave gets zero
  // cache hits on that shared prefix. Running one unit to completion alone
  // first "warms" the cache (its request finishes and the cache entry lands
  // before anyone else starts), so the rest of the fan-out — run afterward at
  // the normal configured concurrency — can actually hit it.
  // Only kicks in when 2+ units still need real work: a resumed run where
  // everything is already done/skipped, or where only one unit is left
  // pending, gets no behavior change (no accidental solo run of a single
  // leftover unit, and no serialization overhead when there's nothing to warm
  // a cache for).
  let processed;
  if (warmStart) {
    const skippable = await Promise.all(
      metas.map((meta) => {
        const { entry } = meta;
        return Boolean(resume && !force && entry.status === "done") && exists(entry.artifact);
      })
    );
    const pendingMetas = metas.filter((_, i) => !skippable[i]);
    if (pendingMetas.length >= 2) {
      const firstPending = pendingMetas[0];
      const restMetas = metas.filter((meta) => meta !== firstPending);

      const firstResult = await processUnit(firstPending);
      const restResults = await mapLimit(restMetas, Math.max(1, Number(concurrency)), processUnit);

      // Splice results back into original unit order.
      processed = new Array(metas.length);
      let r = 0;
      for (let i = 0; i < metas.length; i++) {
        processed[i] = metas[i] === firstPending ? firstResult : restResults[r++];
      }
    }
  }
  if (!processed) {
    processed = await mapLimit(metas, Math.max(1, Number(concurrency)), processUnit);
  }
  await saveManifest();

  return {
    name,
    runDir: runDirAbs,
    manifestPath,
    manifest,
    units: processed,
    results: processed.map((u) => u.result),
    done: processed.filter((u) => u.status === "done"),
    failed: processed.filter((u) => u.status === "failed"),
    skipped: processed.filter((u) => u.skipped),
    counts: manifest.counts,
    totalUsage: manifest.totalUsage,
  };
}
