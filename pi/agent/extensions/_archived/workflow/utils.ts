import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";

export const PI_DIR = ".pi";

export function nowIso(): string {
  return new Date().toISOString();
}

export function compactTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export function slugify(input: string, fallback = "workflow"): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

export function makeRunId(name: string): string {
  return `${compactTimestamp()}-${slugify(name)}`;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJsonFile<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function writeJsonFile(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

export function appendJsonl(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(data)}\n`, "utf8");
}

export function pathExists(file: string): boolean {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

export function resolvePath(cwd: string, maybePath: string): string {
  const expanded = maybePath.startsWith("~/") ? path.join(os.homedir(), maybePath.slice(2)) : maybePath;
  return path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
}

export function relativeOrAbsolute(cwd: string, file: string): string {
  const rel = path.relative(cwd, file);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) return rel || ".";
  return file;
}

export function getProjectPiDir(cwd: string): string {
  return path.join(cwd, PI_DIR);
}

export function getRunsDir(cwd: string): string {
  return path.join(getProjectPiDir(cwd), "runs");
}

export function getWorkflowsDir(cwd: string): string {
  return path.join(getProjectPiDir(cwd), "workflows");
}

export function getAgentsDir(cwd: string): string {
  return path.join(getProjectPiDir(cwd), "agents");
}

export function truncateText(text: string, maxBytes = 50 * 1024): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let out = text.slice(0, maxBytes);
  while (Buffer.byteLength(out, "utf8") > maxBytes) out = out.slice(0, -1);
  return `${out}\n\n[truncated ${Buffer.byteLength(text, "utf8") - Buffer.byteLength(out, "utf8")} bytes]`;
}

export function extractJsonFromText(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const candidates: string[] = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const firstObj = trimmed.indexOf("{");
  const lastObj = trimmed.lastIndexOf("}");
  if (firstObj !== -1 && lastObj > firstObj) candidates.push(trimmed.slice(firstObj, lastObj + 1));
  const firstArr = trimmed.indexOf("[");
  const lastArr = trimmed.lastIndexOf("]");
  if (firstArr !== -1 && lastArr > firstArr) candidates.push(trimmed.slice(firstArr, lastArr + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

export function getFinalAssistantText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "assistant") continue;
    const content = msg.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const text = content
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (text) return text;
    }
  }
  return "";
}

export function splitArgs(raw: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;
  for (const ch of raw) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (escaping) current += "\\";
  if (current) args.push(current);
  return args;
}

export function getFlagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

export function hasFlag(args: string[], ...names: string[]): boolean {
  return names.some((name) => args.includes(name));
}

export function listFilesRecursive(dir: string, predicate: (file: string) => boolean): string[] {
  if (!pathExists(dir)) return [];
  const out: string[] = [];
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && predicate(full)) out.push(full);
    }
  };
  visit(dir);
  return out.sort();
}

export function execFileText(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number; allowFailure?: boolean } = { cwd: process.cwd() },
): Promise<{ stdout: string; stderr: string; code: number | null; killed: boolean }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          killed = true;
          proc.kill("SIGTERM");
          setTimeout(() => {
            if (!proc.killed) proc.kill("SIGKILL");
          }, 5000).unref?.();
        }, options.timeoutMs)
      : undefined;
    proc.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    proc.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      if (options.allowFailure) resolve({ stdout, stderr: stderr || String(error), code: 1, killed });
      else reject(error);
    });
    proc.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      if (!options.allowFailure && code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr, code, killed });
    });
  });
}

export function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) return { command: process.execPath, args };
  return { command: "pi", args };
}

export function safeWriteText(file: string, content: string | Buffer): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content);
}
