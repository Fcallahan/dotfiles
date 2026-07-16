// ~/.pi/agent/workflows/saved/security-review.mjs
// Usage: node ~/.pi/agent/workflows/saved/security-review.mjs [--force] [--retries 2] [--concurrency 16] <file...>
import { spawnAgent, CHEAP_MODEL } from "../lib/agent.mjs";
import { fileFingerprint, parseWorkflowArgs, requireJsonFields, runUnits } from "../lib/runtime.mjs";
import { writeFile } from "node:fs/promises";

const args = parseWorkflowArgs();
const files = args.positionals;
const CONCURRENCY = Number(args.concurrency ?? process.env.PI_WF_CONCURRENCY ?? 16);
const RETRIES = Number(args.retries ?? process.env.PI_WF_RETRIES ?? 2);

if (files.length === 0) {
  console.error("Usage: node ~/.pi/agent/workflows/saved/security-review.mjs [--force] [--retries 2] [--concurrency 16] <file...>");
  process.exit(2);
}

const reviewSchema = requireJsonFields({ summary: "string", findings: "array", confidence: "number" });
const verdictSchema = requireJsonFields({ verdict: "string", reason: "string", confidence: "number" });

// Phase 1 — independent review, one isolated mostly-read-only agent per file.
const reviewRun = await runUnits({
  name: "security-review-files",
  task: "Review files for concrete security findings.",
  units: files,
  concurrency: CONCURRENCY,
  retries: RETRIES,
  resume: args.resume,
  force: args.force,
  fingerprint: fileFingerprint,
  validate: reviewSchema,
  worker: async (file) => spawnAgent({
    tools: "read,bash",
    prompt: `Review ${file} for security issues: injection, broken authz, missing input validation, unsafe deserialization, hardcoded secrets. Report only concrete, line-referenced findings. Empty findings array if clean.`,
  }),
});

const reviews = reviewRun.units.map((u) => ({
  file: u.unit,
  ok: u.status === "done",
  attempts: u.attempts,
  artifact: u.artifact,
  findings: u.result?.findings ?? [],
  error: u.error,
}));

const candidates = reviews.flatMap((r) =>
  r.findings.map((finding) => ({ file: r.file, finding })));

// Phase 2 — adversarial verification. Separate agent, separate context, tries to REFUTE.
const verifyRun = await runUnits({
  name: "security-review-verification",
  task: "Adversarially verify claimed security findings.",
  units: candidates,
  concurrency: CONCURRENCY,
  retries: RETRIES,
  resume: args.resume,
  force: args.force,
  fingerprint: async (c) => `${await fileFingerprint(c.file)}:${JSON.stringify(c.finding)}`,
  validate: verdictSchema,
  worker: async (c) => spawnAgent({
    tools: "read,bash",
    model: CHEAP_MODEL,
    // To route refute-verification through the claude/opus harness instead
    // (higher-stakes reviews only — narrow, subscription-rate-limited):
    //   role: "verifier", tools: "read,bash",
    // Leave the CHEAP_MODEL line above as-is for the default behavior.
    outputContract: '{ "verdict": "confirmed" | "rejected", "reason": string, "confidence": number }',
    prompt: `A reviewer claims this finding in ${c.file}: ${JSON.stringify(c.finding)}\nRead the code and surrounding context and try to REFUTE it. Confirm only if there is concrete code evidence.`,
  }),
});

const verified = verifyRun.units.map((u) => ({
  ...u.unit,
  ok: u.status === "done",
  attempts: u.attempts,
  artifact: u.artifact,
  verdict: u.result?.verdict ?? "rejected",
  reason: u.result?.reason ?? u.error ?? "Verifier produced no usable artifact.",
}));

const confirmed = verified.filter((v) => v.verdict === "confirmed");
const failedReviews = reviewRun.failed.length;
const failedVerifications = verifyRun.failed.length;

// Phase 3 — single merged artifact.
await writeFile("workflow-report.md",
  `# Security review\n\n${files.length} files · ${candidates.length} raw · ${confirmed.length} confirmed\n\n` +
  `Review run: ${reviewRun.manifestPath}\n\nVerification run: ${verifyRun.manifestPath}\n\n` +
  (reviewRun.skipped.length || verifyRun.skipped.length
    ? `Resumed: ${reviewRun.skipped.length} review unit(s), ${verifyRun.skipped.length} verifier unit(s) reused from artifacts.\n\n`
    : "") +
  (failedReviews || failedVerifications
    ? `> Warning: ${failedReviews} review unit(s), ${failedVerifications} verifier unit(s) failed after retries. See manifests above.\n\n`
    : "") +
  (confirmed.length
    ? confirmed.map((c) =>
        `## ${c.file}\n${c.reason}\n\n\`\`\`json\n${JSON.stringify(c.finding, null, 2)}\n\`\`\``
      ).join("\n\n")
    : "No confirmed findings.\n"),
  "utf8");

console.log(`DONE: ${confirmed.length} confirmed → workflow-report.md`);
