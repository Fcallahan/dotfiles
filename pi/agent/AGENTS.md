# Infrastructure

We run **EKS with EC2 node groups, not Fargate**, across our AWS devops. Default every deployment
target, Terraform/manifest suggestion, and architecture diagram to EKS-on-EC2 — Deployments/
Services/Ingress via the AWS Load Balancer Controller, IRSA for pod-level AWS access, EC2 worker
nodes (not Fargate profiles) — unless a project explicitly says otherwise. (Confirmed by the
`Karpenter-<cluster>-*` SQS interruption queues present across environments in the `ems` AWS
account — Karpenter provisions EC2 capacity, not Fargate.)

## Keep Long-Running Work in the Background

Keep the foreground Pi conversation responsive. When a mechanical command is likely to run for roughly one minute or longer and its final result is not required before replying, use `managed_bash` with `run_in_background=true` instead of holding a `bash` tool call open. This includes CI monitors, test suites, builds, imports, log collection, and open-ended polling.

Return the managed job ID and output path. Use `background_jobs` only when the user asks for progress, logs, shutdown, or restart; do not replace the background job with a foreground polling loop. Use ordinary `bash` for short commands whose output is needed in the current turn. Use async subagents for work that needs ongoing model reasoning, and use `run_dynamic_workflow` with `runInBackground=true` only when the workflow can proceed independently without returning its final artifact in the current turn.

`Ctrl+B` moves an active foreground `managed_bash` job into the background. It must retain its normal cursor-left behavior when no managed foreground job is running. Background execution does not relax approval, production-safety, or environment-specific controls.

## Risk-Based Consolidated Changed-Code Review

Use one consolidated changed-code review at an implementation-slice or PR boundary when changes affect persistence or state transitions, migrations or database invariants, concurrency, security, public contracts, cross-platform automation, or broad cross-cutting behavior.

1. Before editing, capture the repository baseline, pre-existing dirty files, and files attributable to the task so the final review can be isolated.
2. Review only code changed by the current task. Read nearby unchanged code only for context and never broaden into unrelated work.
3. Include readability, maintainability, repository consistency, static-analysis compatibility, and language-specific checks from the `changed-code-review-checklist` skill in that same review. Do not run a separate style-review gate.
4. Skip reviewer dispatch for small localized changes, tests-only changes, direct copies of established repository patterns, and formatting or naming already enforced by configured analyzers. The parent still owns focused validation and final-diff inspection.
5. Critical findings stop completion. High and Medium fixes require one bounded follow-up review. Low findings are advisory; the parent may fix or defer them and verifies accepted fixes without launching another reviewer.
6. Do not run per-file or per-finding review loops. If the consolidated reviewer is unavailable, perform the normal verification that remains possible and report the review limitation only when the risk criteria above required independent review.
