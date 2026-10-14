import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function hasCommand(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const MAX_DIFF_BYTES = 1_500_000;
const MAX_UNTRACKED_FILE_BYTES = 250_000;

interface ReviewContext {
  isIdle(): boolean;
  hasUI: boolean;
  cwd: string;
  ui: {
    notify(message: string, type?: "info" | "warning" | "error" | "success"): void;
    custom<T>(factory: (tui: { stop(): void; start(): void; requestRender(force?: boolean): void }, theme: unknown, kb: unknown, done: (value: T) => void) => unknown): Promise<T>;
  };
}

interface ParsedArgs {
  scope: "all" | "staged" | "unstaged";
  paths: string[];
  help: boolean;
  contextLines: number;
}

interface ChangedFile {
  path: string;
  status: string;
}

interface ReviewFile {
  reviewPath: string;
  jsonPath: string;
  hasChanges: boolean;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("nvim-review", {
    description: "Review git changes side by side in nvim and send inline comments back to the agent",
    async handler(args: string, ctx: ReviewContext) {
      await runNvimReview(pi, args, ctx);
    },
  });
}

export async function runNvimReview(pi: ExtensionAPI, args: string, ctx: ReviewContext): Promise<void> {
  const parsed = parseArgs(args);
  if (parsed.help) {
    ctx.ui.notify("Usage: /nvim-review [--staged|--unstaged] [--context=N] [path ...]", "info");
    return;
  }

  if (!isGitRepo(ctx.cwd)) {
    ctx.ui.notify("/nvim-review requires a git repository", "error");
    return;
  }

  const editor = resolveEditor();
  if (!editor) {
    ctx.ui.notify("/nvim-review requires nvim or vim, or set PI_REVIEW_EDITOR/VISUAL/EDITOR", "error");
    return;
  }

  const review = createReviewDiff(ctx.cwd, parsed);
  if (!review.hasChanges) {
    ctx.ui.notify("No changes found to review", "info");
    return;
  }

  if (!ctx.hasUI) {
    ctx.ui.notify(`Review diff created: ${review.reviewPath}`, "info");
    return;
  }

  const exitCode = await ctx.ui.custom<number | null>((tui, _theme, _kb, done) => {
    tui.stop();
    process.stdout.write("\x1b[2J\x1b[H");

    const command = buildEditorCommand(editor, review.reviewPath);
    const shell = process.env.SHELL || "/bin/sh";
    const result = spawnSync(shell, ["-lc", command], {
      cwd: ctx.cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        PI_REVIEW_ROOT: ctx.cwd,
        PI_REVIEW_DIFF: review.reviewPath,
        PI_REVIEW_JSON: review.jsonPath,
        PI_REVIEW_SCOPE: parsed.scope,
        PI_REVIEW_BACKEND: "diffview",
        PI_REVIEW_DIFFVIEW_ARGS: JSON.stringify(buildDiffviewArgs(parsed)),
      },
    });

    tui.start();
    tui.requestRender(true);
    done(result.status ?? 1);
    return { render: () => [], invalidate: () => {} };
  });

  if (exitCode !== 0) {
    ctx.ui.notify(`/nvim-review editor exited with code ${exitCode}`, "warning");
    return;
  }

  const comments = extractReviewCommentsFromJson(review.jsonPath);
  if (!comments.trim()) {
    ctx.ui.notify("No review comments found", "info");
    return;
  }

  const message = `Please address these inline review comments from my side-by-side nvim diff review.\n\n${comments.trim()}`;
  if (ctx.isIdle()) {
    pi.sendUserMessage(message);
    ctx.ui.notify("Review comments sent to agent", "success");
  } else {
    pi.sendUserMessage(message, { deliverAs: "followUp" });
    ctx.ui.notify("Review comments queued for agent", "info");
  }
}

function buildDiffviewArgs(parsed: ParsedArgs): string[] {
  const args = parsed.scope === "staged" ? ["--cached"] : parsed.scope === "all" ? ["HEAD"] : [];
  if (parsed.paths.length > 0) args.push("--", ...parsed.paths);
  return args;
}

function parseArgs(args: string): ParsedArgs {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  let scope: ParsedArgs["scope"] = "all";
  const paths: string[] = [];
  let help = false;
  let contextLines = 999_999;

  for (const part of parts) {
    if (part === "--help" || part === "-h") help = true;
    else if (part === "--staged" || part === "--cached") scope = "staged";
    else if (part === "--unstaged" || part === "--worktree") scope = "unstaged";
    else if (part.startsWith("--context=")) {
      const n = Number(part.slice("--context=".length));
      if (Number.isFinite(n) && n >= 0) contextLines = Math.floor(n);
    } else paths.push(part);
  }

  return { scope, paths, help, contextLines };
}

function isGitRepo(cwd: string): boolean {
  try {
    return git(cwd, ["rev-parse", "--is-inside-work-tree"]).trim() === "true";
  } catch {
    return false;
  }
}

function createReviewDiff(cwd: string, parsed: ParsedArgs): ReviewFile {
  const reviewDir = join(cwd, ".pi", "reviews");
  mkdirSync(reviewDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reviewPath = join(reviewDir, `nvim-review-${stamp}.diff`);
  const jsonPath = join(reviewDir, `nvim-review-${stamp}.json`);
  const status = safeGit(cwd, ["status", "--short", "-uall"]);
  const changedFiles = getChangedFiles(cwd, parsed.paths, parsed.scope);
  const trackedDiff = collectFullContextDiff(cwd, parsed);
  const untrackedDiff = parsed.scope === "staged" ? "" : collectUntrackedDiff(cwd, changedFiles);
  const diff = [trackedDiff, untrackedDiff].filter((part) => part.trim()).join("\n");
  const hasChanges = Boolean(diff.trim() || changedFiles.length > 0);

  const rendered = renderReviewDiff({ cwd, parsed, status, changedFiles, diff });
  writeFileSync(reviewPath, rendered, "utf-8");

  return { reviewPath, jsonPath, hasChanges };
}

function collectFullContextDiff(cwd: string, parsed: ParsedArgs): string {
  const pathArgs = buildPathArgs(parsed.paths);
  const context = `--unified=${parsed.contextLines}`;
  const args =
    parsed.scope === "staged"
      ? ["diff", "--no-color", context, "--cached", ...pathArgs]
      : parsed.scope === "unstaged"
        ? ["diff", "--no-color", context, ...pathArgs]
        : ["diff", "--no-color", context, "HEAD", ...pathArgs];

  let output = safeGit(cwd, args, MAX_DIFF_BYTES + 10_000);
  if (!output.trim() && parsed.scope === "all") {
    const staged = safeGit(cwd, ["diff", "--no-color", context, "--cached", ...pathArgs], MAX_DIFF_BYTES);
    const unstaged = safeGit(cwd, ["diff", "--no-color", context, ...pathArgs], MAX_DIFF_BYTES);
    output = [staged, unstaged].filter((part) => part.trim()).join("\n");
  }

  return truncateText(output, MAX_DIFF_BYTES, "diff");
}

function collectUntrackedDiff(cwd: string, files: ChangedFile[]): string {
  const sections: string[] = [];
  for (const file of files.filter((f) => f.status === "??" || f.status === "?")) {
    const abs = join(cwd, file.path);
    if (!existsSync(abs)) continue;
    const stat = statSync(abs);
    if (!stat.isFile()) continue;
    if (stat.size > MAX_UNTRACKED_FILE_BYTES) {
      sections.push(`diff --git a/${file.path} b/${file.path}`);
      sections.push("new file mode 100644");
      sections.push("--- /dev/null");
      sections.push(`+++ b/${file.path}`);
      sections.push(`@@ -0,0 +1,1 @@`);
      sections.push(`+[untracked file omitted: ${stat.size} bytes exceeds ${MAX_UNTRACKED_FILE_BYTES} byte limit]`);
      continue;
    }

    const buf = readFileSync(abs);
    if (buf.includes(0)) {
      sections.push(`diff --git a/${file.path} b/${file.path}`);
      sections.push("new file mode 100644");
      sections.push("--- /dev/null");
      sections.push(`+++ b/${file.path}`);
      sections.push(`@@ -0,0 +1,1 @@`);
      sections.push("+[binary untracked file omitted]");
      continue;
    }

    const content = buf.toString("utf-8").replace(/\r\n/g, "\n");
    const lines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
    sections.push(`diff --git a/${file.path} b/${file.path}`);
    sections.push("new file mode 100644");
    sections.push("--- /dev/null");
    sections.push(`+++ b/${file.path}`);
    sections.push(`@@ -0,0 +1,${Math.max(lines.length, 1)} @@`);
    for (const line of lines) sections.push(`+${line}`);
    if (!content.endsWith("\n")) sections.push("\\ No newline at end of file");
  }

  return sections.join("\n");
}

function getChangedFiles(cwd: string, pathFilters: string[], scope: ParsedArgs["scope"]): ChangedFile[] {
  const output = safeGit(cwd, ["status", "--porcelain=v1", "-z", "-uall"]);
  const entries = output.split("\0");
  const files: ChangedFile[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || entry.length < 4) continue;

    const xy = entry.slice(0, 2);
    let filePath = entry.slice(3);
    if ((xy[0] === "R" || xy[0] === "C") && entries[i + 1]) {
      i += 1;
      filePath = entries[i];
    }

    if (isInternalReviewPath(filePath)) continue;
    if (!matchesScope(xy, scope)) continue;
    if (!matchesPathFilters(filePath, pathFilters)) continue;
    files.push({ path: filePath, status: xy.trim() || "modified" });
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function buildPathArgs(paths: string[]): string[] {
  if (paths.length > 0) return ["--", ...paths];
  return ["--", ".", ":(exclude).pi/reviews/**"];
}

function isInternalReviewPath(filePath: string): boolean {
  return filePath === ".pi/reviews" || filePath.startsWith(".pi/reviews/");
}

function matchesScope(xy: string, scope: ParsedArgs["scope"]): boolean {
  if (scope === "all") return true;
  if (scope === "staged") return xy[0] !== " " && xy[0] !== "?";
  return xy[1] !== " " || xy[0] === "?";
}

function matchesPathFilters(filePath: string, filters: string[]): boolean {
  if (filters.length === 0) return true;
  return filters.some((filter) => filePath === filter || filePath.startsWith(`${filter}/`) || filter.startsWith(`${filePath}/`));
}

function renderReviewDiff(input: { cwd: string; parsed: ParsedArgs; status: string; changedFiles: ChangedFile[]; diff: string }): string {
  const lines = [
    "# Pi side-by-side nvim review",
    `# cwd: ${input.cwd}`,
    `# generated: ${new Date().toISOString()}`,
    `# scope: ${input.parsed.scope}`,
    `# context: ${input.parsed.contextLines}`,
  ];
  if (input.parsed.paths.length > 0) lines.push(`# paths: ${input.parsed.paths.join(", ")}`);
  lines.push("# Changed files:");
  if (input.changedFiles.length === 0) lines.push("#   none");
  for (const file of input.changedFiles) lines.push(`#   ${file.status.padEnd(2)} ${file.path}`);
  lines.push("# Git status:");
  for (const line of (input.status || "clean").trimEnd().split("\n")) lines.push(`#   ${line}`);
  lines.push("# ---- diff starts below ----", input.diff || "# No tracked-file diff for this scope.", "");
  return lines.join("\n");
}

function extractReviewCommentsFromJson(jsonPath: string): string {
  if (!existsSync(jsonPath)) return "";

  try {
    const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
    if (!Array.isArray(data.comments)) return "";

    return data.comments
      .filter((comment: { body?: string; resolved?: boolean }) => !comment.resolved && comment.body?.trim())
      .map((comment: { file?: string; line?: number; body: string }) => {
        const location = comment.file ? `${comment.file}${comment.line ? `:${comment.line}` : ""}` : "general";
        return `- ${location}: ${comment.body.trim()}`;
      })
      .join("\n");
  } catch {
    return "";
  }
}

function resolveEditor(): string | undefined {
  const configured = process.env.PI_REVIEW_EDITOR || process.env.VISUAL || process.env.EDITOR;
  if (configured?.trim()) return configured.trim();
  if (hasCommand("nvim")) return "nvim";
  if (hasCommand("vim")) return "vim";
  return undefined;
}

function buildEditorCommand(editor: string, reviewPath: string): string {
  return `${editor} -c "lua require('tuliopaim.pi_review').start()" ${shellQuote(reviewPath)}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function git(cwd: string, args: string[], maxBuffer = 5_000_000): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", maxBuffer, stdio: ["ignore", "pipe", "pipe"] });
}

function safeGit(cwd: string, args: string[], maxBuffer = 5_000_000): string {
  try {
    return git(cwd, args, maxBuffer);
  } catch {
    return "";
  }
}

function truncateText(text: string, maxBytes: number, label: string): string {
  const bytes = Buffer.byteLength(text, "utf-8");
  if (bytes <= maxBytes) return text;
  const truncated = text.slice(0, maxBytes);
  return `${truncated}\n\n# [${label} truncated at ${maxBytes} bytes; use --context=N or git/nvim directly for complete output.]\n`;
}
