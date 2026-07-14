import assert from "node:assert/strict";
import test from "node:test";
import { isReadOnlyCommand } from "./utils.ts";

const allowed = [
  "git -C ../../HelmCharts status --short --branch && git -C ../../HelmCharts diff -- charts/a charts/b && git -C ../../HelmCharts diff --cached -- charts/a charts/b",
  "git -C ../../HelmCharts log -5 --oneline --decorate && printf '\\nEffective blocks:\\n'",
  "pwd; git rev-parse --show-toplevel; git branch --show-current; git status --short; printf '\\n--- merge base ---\\n'; git rev-parse --verify origin/main 2>&1 || true; printf '\\n--- recent log ---\\n'; git log --oneline --decorate -12",
  "git show missing 2>/dev/null || true",
  "rg -n 'application:|environment:' ../../HelmCharts/charts/emstatus-{webapi,claimsconsumer}-prod",
  "find ~/.pi/agent/skills -maxdepth 2 -type f && ls -la ~/.pi/agent/prompts",
  "for f in ../../HelmCharts/charts/*/values.yaml; do echo \"--- $f\"; awk '/^appConfig:/{p=1} p{print}' \"$f\"; done",
  "psql service=stage -c 'BEGIN TRANSACTION READ ONLY; SELECT id FROM jobs LIMIT 10; ROLLBACK;'",
];

const blocked = [
  "git -C ../../HelmCharts checkout main",
  "git -C ../../HelmCharts status && rm -rf /tmp/example",
  "cat input > output",
  "git status 2> errors.log",
  "git status | cat",
  "echo $(touch /tmp/example)",
  "rg needle . | xargs rm",
  "for f in *; do rm \"$f\"; done",
  "psql service=stage -c 'DELETE FROM jobs'",
  "psql service=stage -c 'BEGIN; DROP TABLE jobs; COMMIT;'",
];

test("allows composed read-only inspection commands", () => {
  for (const command of allowed) assert.equal(isReadOnlyCommand(command), true, command);
});

test("blocks mutations and ambiguous shell syntax", () => {
  for (const command of blocked) assert.equal(isReadOnlyCommand(command), false, command);
});
