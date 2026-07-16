import * as fs from "node:fs";
import * as path from "node:path";
import { execFileText, ensureDir, pathExists, safeWriteText, slugify } from "./utils.ts";

export class WorktreeManager {
  constructor(private cwd: string, private runDir: string) {}

  async isGitRepo(): Promise<boolean> {
    const result = await execFileText("git", ["rev-parse", "--is-inside-work-tree"], { cwd: this.cwd, allowFailure: true, timeoutMs: 5000 });
    return result.code === 0 && result.stdout.trim() === "true";
  }

  async snapshotGit(artifactDir: string): Promise<Record<string, string>> {
    ensureDir(artifactDir);
    const artifacts: Record<string, string> = {};
    if (!(await this.isGitRepo())) {
      const file = path.join(artifactDir, "git-unavailable.txt");
      safeWriteText(file, "Not a git repository or git unavailable.\n");
      artifacts.git_status = file;
      return artifacts;
    }
    const status = await execFileText("git", ["status", "--short", "--branch"], { cwd: this.cwd, allowFailure: true, timeoutMs: 10_000 });
    const diff = await execFileText("git", ["diff", "--binary", "HEAD"], { cwd: this.cwd, allowFailure: true, timeoutMs: 20_000 });
    const nameOnly = await execFileText("git", ["diff", "--name-only", "HEAD"], { cwd: this.cwd, allowFailure: true, timeoutMs: 10_000 });
    artifacts.git_status = path.join(artifactDir, "git-status.txt");
    artifacts.git_diff = path.join(artifactDir, "git-diff.patch");
    artifacts.diff_summary = path.join(artifactDir, "diff-summary.md");
    safeWriteText(artifacts.git_status, status.stdout || status.stderr);
    safeWriteText(artifacts.git_diff, diff.stdout || diff.stderr);
    safeWriteText(artifacts.diff_summary, `# Git diff summary\n\n## Changed files\n\n${(nameOnly.stdout || "").split("\n").filter(Boolean).map((f) => `- ${f}`).join("\n") || "No changed files."}\n\n## Status\n\n\`\`\`\n${status.stdout || status.stderr}\n\`\`\`\n`);
    return artifacts;
  }

  async create(runId: string, agentName: string, baseRef = "HEAD"): Promise<string> {
    if (!(await this.isGitRepo())) throw new Error("Worktree isolation requires a git repository");
    const safeAgent = slugify(agentName, "agent");
    const worktreePath = path.join(this.runDir, "worktrees", safeAgent);
    if (pathExists(worktreePath)) return worktreePath;
    ensureDir(path.dirname(worktreePath));
    const branch = `pi/${slugify(runId, "run")}/${safeAgent}`;
    let result = await execFileText("git", ["worktree", "add", worktreePath, "-b", branch, baseRef], { cwd: this.cwd, allowFailure: true, timeoutMs: 60_000 });
    if (result.code !== 0 && /already exists|is already checked out|A branch named/.test(result.stderr + result.stdout)) {
      result = await execFileText("git", ["worktree", "add", worktreePath, baseRef], { cwd: this.cwd, allowFailure: true, timeoutMs: 60_000 });
    }
    if (result.code !== 0) throw new Error(`git worktree add failed: ${result.stderr || result.stdout}`);
    return worktreePath;
  }

  async diff(worktreePath: string): Promise<string> {
    if (!pathExists(worktreePath)) return "";
    const result = await execFileText("git", ["diff", "--binary", "HEAD"], { cwd: worktreePath, allowFailure: true, timeoutMs: 60_000 });
    return result.stdout || result.stderr;
  }

  async status(worktreePath = this.cwd): Promise<string> {
    const result = await execFileText("git", ["status", "--short", "--branch"], { cwd: worktreePath, allowFailure: true, timeoutMs: 10_000 });
    return result.stdout || result.stderr;
  }

  async cleanup(worktreePath: string): Promise<void> {
    if (!pathExists(worktreePath)) return;
    await execFileText("git", ["worktree", "remove", "--force", worktreePath], { cwd: this.cwd, allowFailure: true, timeoutMs: 60_000 });
    if (pathExists(worktreePath)) fs.rmSync(worktreePath, { recursive: true, force: true });
  }
}
