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
