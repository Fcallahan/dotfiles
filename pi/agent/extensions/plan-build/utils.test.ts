import assert from "node:assert/strict";
import test from "node:test";
import { classifyShellCommand, decideShellCommand, isReadOnlyCommand } from "./utils.ts";

const allowed = [
  // Composed read-only inspection commands via pipes, &&, ;
  "git -C ../../HelmCharts status --short --branch && git -C ../../HelmCharts diff -- charts/a charts/b && git -C ../../HelmCharts diff --cached -- charts/a charts/b",
  "git -C ../../HelmCharts log -5 --oneline --decorate && printf '\\nEffective blocks:\\n'",
  "pwd; git rev-parse --show-toplevel; git branch --show-current; git status --short; printf '\\n--- merge base ---\\n'; git rev-parse --verify origin/main 2>&1 || true; printf '\\n--- recent log ---\\n'; git log --oneline --decorate -12",
  "git show missing 2>/dev/null || true",
  "rg -n 'application:|environment:' ../../HelmCharts/charts/emstatus-{webapi,claimsconsumer}-prod",
  "find ~/.pi/agent/skills -maxdepth 2 -type f && ls -la ~/.pi/agent/prompts",
  "for f in ../../HelmCharts/charts/*/values.yaml; do echo \"--- $f\"; awk '/^appConfig:/{p=1} p{print}' \"$f\"; done",
  "psql service=stage -c 'BEGIN TRANSACTION READ ONLY; SELECT id FROM jobs LIMIT 10; ROLLBACK;'",
  // Pipes: now allowed since each segment is validated independently
  "git log --oneline | head -20",
  "cat file.txt | grep needle",
  "ls -la | awk '{print $1}' | sort | uniq",
  "git log --oneline --format='%h %ai %an %s' | head -30",
  // gh read-only
  "gh pr view 5554 --json title,author,commits",
  "gh pr list --limit 10",
  "gh issue view 123",
  "gh search prs --reviewer=fcallahan-mc",
  "gh api /repos/owner/repo/pulls",
  // acli read-only
  "acli jira workitem view EMSVC-123 --json",
  "acli jira search 'project = BILLING'",
  "acli jira project list",
  // aws read-only
  "aws ec2 describe-instances",
  "aws s3 ls",
  "aws --endpoint-url http://localhost:4566 secretsmanager list-secrets",
  // kubectl read-only
  "kubectl get pods -n default",
  "kubectl describe deployment api",
  "kubectl logs -l app=nginx --tail=10",
  // docker read-only
  "docker ps -a",
  "docker images",
  "docker inspect container_name",
  // dotnet read-only
  "dotnet --version",
  "dotnet --list-sdks",
  "dotnet --info",
  // git submodule / blame / shortlog
  "git submodule status",
  "git blame src/file.cs",
  "git shortlog -sn --since=2026-01-01",
  // Pipes with read-only commands
  "git status | cat",
  // Redirects to /dev/null
  "git show missing 2>/dev/null",
  "git status 2>&1 | head -5",
  "rg pattern 2>/dev/null || true",
];

const unknown = [
  "curl -fsSL https://www.githubstatus.com/api/v2/components.json",
  "hermes cron list --json",
  "/home/franciscallahan/.pi/agent/skills/environment-troubleshooter/scripts/aws-readonly.sh identity",
];

const blocked = [
  "git -C ../../HelmCharts checkout main",
  "git -C ../../HelmCharts status && rm -rf /tmp/example",
  "cat input > output",
  "git status 2> errors.log",
  "echo $(touch /tmp/example)",
  "rg needle . | xargs rm",
  "for f in *; do rm \"$f\"; done",
  "psql service=stage -c 'DELETE FROM jobs'",
  "psql service=stage -c 'BEGIN; DROP TABLE jobs; COMMIT;'",
  // Mutations
  "git add .",
  "git commit -m 'test'",
  "git push origin main",
  "gh pr checkout 123",
  "gh pr merge 123",
  "gh issue close 123",
  "acli jira workitem transition EMSVC-123",
  "aws s3 cp file.txt s3://bucket/",
  "kubectl apply -f deploy.yaml",
  "kubectl delete pod nginx",
  "docker run nginx",
  "docker build -t image .",
  "docker system prune",
  "dotnet build",
  "dotnet test",
  "dotnet ef migrations add Test",
  "npm install",
  "rm -rf node_modules",
  "sudo apt-get update",
  // Ambiguous: file write via >
  "echo hello > file.txt",
  // Backtick / $() — sub shell execution
  "echo $(git branch)",
  "cat `which ls`",
];

test("allows composed read-only inspection commands", () => {
  for (const command of allowed) assert.equal(isReadOnlyCommand(command), true, command);
});

test("classifies unfamiliar but structurally simple commands as unknown", () => {
  for (const command of unknown) {
    assert.equal(classifyShellCommand(command), "unknown", command);
    assert.deepEqual(decideShellCommand(command, true), { classification: "unknown", action: "confirm" }, command);
    assert.deepEqual(decideShellCommand(command, false), { classification: "unknown", action: "block" }, command);
  }
});

test("blocks mutations and ambiguous shell syntax", () => {
  for (const command of blocked) {
    assert.equal(isReadOnlyCommand(command), false, command);
    assert.deepEqual(
      decideShellCommand(command, true),
      { classification: "mutating-or-ambiguous", action: "block" },
      command,
    );
  }
});
