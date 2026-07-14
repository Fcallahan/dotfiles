// ~/.pi/agent/workflows/lib/agent.mjs
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL_FLAG = "--model"; // verified for this pi build
const DEFAULT_MODEL = process.env.PI_WF_MODEL ?? "deepseek/deepseek-v4-flash";
const CHEAP_MODEL = process.env.PI_WF_CHEAP ?? "deepseek/deepseek-v4-flash";
const DEFAULT_PROVIDER = process.env.PI_WF_PROVIDER ?? "openrouter";

function withArtifactWriteTool(tools) {
  const list = String(tools || "").split(",").map((t) => t.trim()).filter(Boolean);
  if (!list.includes("write")) list.push("write");
  return list.join(",");
}

// Spawn one isolated headless pi subagent. Resolves { ok, result, code }.
export async function spawnAgent({
  prompt,
  model = DEFAULT_MODEL,
  tools = "read,bash,edit,write",
  cwd = process.cwd(),
  appendSystemPrompt,
  timeoutMs = 15 * 60_000,
  outputContract = '{ "summary": string, "findings": array, "confidence": number }',
}) {
  const dir = await mkdtemp(join(tmpdir(), "pi-wf-"));
  const promptPath = join(dir, "prompt.md");
  const outPath = join(dir, "out.json");

  // Contract: subagent MUST write its answer as JSON to outPath via the write tool.
  const framed = `${prompt}

---
When finished, use the write tool to save a single JSON object to this EXACT path:
${outPath}
Do not print the JSON to stdout.
Do not write anywhere else unless the task explicitly asks you to modify project files.
Required shape: ${outputContract}`;

  await writeFile(promptPath, framed, "utf8");

  const args = [
    MODEL_FLAG, model,
    "--provider", DEFAULT_PROVIDER,
    "--no-session",
    "--mode", "json",
    "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
    "--offline",
    "--tools", withArtifactWriteTool(tools),
    "-p", `@${promptPath}`,
  ];
  if (appendSystemPrompt) args.push("--append-system-prompt", `@${appendSystemPrompt}`);

  const code = await new Promise((resolve) => {
    let settled = false;
    const finish = (c) => {
      if (!settled) {
        settled = true;
        clearTimeout(kill);
        resolve(c);
      }
    };
    const p = spawn("pi", args, { cwd, env: { ...process.env, PI_OFFLINE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    const kill = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", () => {}); // drain; read artifact instead of stdout
    p.stderr.on("data", () => {});
    p.on("error", () => finish(-1));
    p.on("close", (c) => finish(c));
  });

  try {
    return { ok: true, result: JSON.parse(await readFile(outPath, "utf8")), code, workDir: dir, promptPath, outPath };
  } catch {
    return { ok: false, result: null, code, workDir: dir, promptPath, outPath };
  }
}

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

export { CHEAP_MODEL };
