---
description: Run the saved security-review workflow over given files.
argument-hint: "<file...>"
---
Run:

```bash
node ~/.pi/agent/workflows/saved/security-review.mjs $ARGUMENTS
```

Use this saved workflow only when per-file isolation matters. For normal changed-code or PR review, run one consolidated reviewer over the bounded diff instead. Then summarize `workflow-report.md`. Do not re-do the analysis yourself.
