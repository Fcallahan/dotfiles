// ~/.pi/agent/workflows/lib/runtime.mjs
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { mapLimit } from "./agent.mjs";

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
    return { ok: Boolean(raw.ok), result: raw.result, code: raw.code, meta };
  }
  return { ok: true, result: raw, code: undefined, meta: undefined };
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
} = {}) {
  if (!name) throw new Error("runUnits requires name");
  if (!Array.isArray(units)) throw new Error("runUnits requires units array");
  if (typeof worker !== "function") throw new Error("runUnits requires worker function");

  const runDirAbs = resolve(runDir ?? join(process.cwd(), ".pi", "workflows", "runs", slugify(name, "workflow")));
  const manifestPath = join(runDirAbs, "manifest.json");
  await mkdir(join(runDirAbs, "units"), { recursive: true });

  const loaded = force ? undefined : await readJson(manifestPath);
  const now = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    invocationId: process.env.PI_DYNAMIC_WORKFLOW_RUN_ID,
    name,
    task,
    runDir: runDirAbs,
    createdAt: loaded?.createdAt ?? now,
    updatedAt: now,
    options: { concurrency, retries, resume, force },
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
      await saveManifest();
    }

    while (entry.attempts < maxAttempts) {
      entry.status = "running";
      entry.attempts++;
      entry.startedAt = new Date().toISOString();
      entry.updatedAt = entry.startedAt;
      delete entry.error;
      await saveManifest();

      try {
        const raw = await worker(unit, { key, entry, attempt: entry.attempts, artifact: entry.artifact, index: entry.index });
        const normalized = normalizeWorkerResult(raw);
        entry.code = normalized.code;
        if (normalized.meta) entry.worker = normalized.meta;
        if (!normalized.ok) throw new Error(`worker returned ok=false code=${normalized.code ?? "unknown"}`);
        const err = validationError(validate, normalized.result);
        if (err) throw new Error(`result validation failed: ${err}`);
        await writeJsonAtomic(entry.artifact, normalized.result);
        entry.status = "done";
        entry.finishedAt = new Date().toISOString();
        entry.updatedAt = entry.finishedAt;
        delete entry.error;
        await saveManifest();
        return { ...meta, status: "done", skipped: false, result: normalized.result, code: normalized.code, artifact: entry.artifact, attempts: entry.attempts };
      } catch (err) {
        entry.status = "failed";
        entry.error = err?.stack || err?.message || String(err);
        entry.updatedAt = new Date().toISOString();
        await saveManifest();
        if (entry.attempts < maxAttempts && retryDelayMs > 0) await sleep(retryDelayMs);
      }
    }

    return { ...meta, status: "failed", skipped: false, result: null, code: entry.code, error: entry.error, artifact: entry.artifact, attempts: entry.attempts };
  }

  const processed = await mapLimit(metas, Math.max(1, Number(concurrency)), processUnit);
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
  };
}
