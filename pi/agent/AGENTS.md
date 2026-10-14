# Infrastructure

We run **EKS with EC2 node groups, not Fargate**, across our AWS devops. Default every deployment
target, Terraform/manifest suggestion, and architecture diagram to EKS-on-EC2 — Deployments/
Services/Ingress via the AWS Load Balancer Controller, IRSA for pod-level AWS access, EC2 worker
nodes (not Fargate profiles) — unless a project explicitly says otherwise. (Confirmed by the
`Karpenter-<cluster>-*` SQS interruption queues present across environments in the `ems` AWS
account — Karpenter provisions EC2 capacity, not Fargate.)

## Keep Long-Running Work in the Background

Keep the foreground Pi conversation responsive. When a mechanical command is likely to run for roughly one minute or longer and its final result is not required before replying, use `managed_bash` with `run_in_background=true` instead of holding a `bash` tool call open. This includes CI monitors, test suites, builds, imports, log collection, and open-ended polling.

Report the managed job ID and output path. When a job finishes, Pi sends a `background-job-notification` with its status, exit code, and last output, and starts a turn if the agent is idle. When the next step depends on a job, say what happens next and end the turn; continue as soon as the notification arrives instead of waiting for the user to ask. On a failure the task depends on, read the log, classify it (real defect, environment or infrastructure, or too-short timeout), then fix and retry at most twice for the same failure before reporting the exact error. Use `background_jobs action=wait` only for a short dependency that must resolve in the current turn, and never replace a background job with a foreground polling loop. Pass `notify=false` for long-lived services the user watches, such as dev servers, dashboards, watchers, and review UIs. Use ordinary `bash` for short commands whose output is needed in the current turn. Use async subagents for work that needs ongoing model reasoning, and use `run_dynamic_workflow` with `runInBackground=true` only when the workflow can proceed independently without returning its final artifact in the current turn.

`Ctrl+B` moves an active foreground `managed_bash` job into the background. It must retain its normal cursor-left behavior when no managed foreground job is running. Background execution does not relax approval, production-safety, or environment-specific controls.

## Actionable Decisions in Herdr

When a decision, clarification, or required approval is waiting on Francis, use Pi's `question` tool with the actual decision as its first line. Do not just print "approve this commit" or end a chat message with a question and leave the session looking finished. The tool reports `herdr:blocked` while the dialog is pending so Herdr can highlight the session and play its attention sound; answering or canceling clears that state.

Use this only for real human input. CI polling, another agent's reservation, a background command, and an unverified Gitar suggestion are not human-input states and must not trigger an approval prompt or attention alert. Ordinary scoped PR-feedback commits/pushes already have implied authorization. Verify bot advice first; continue confirmed in-scope fixes, and use the actionable prompt only for a genuine unresolved decision.

## Pattern Instructions

Before writing any code, always examine the existing codebase patterns in the repository you're working on, and cross-reference with the EMSMC Service Templates solution at `/home/franciscallahan/code/Work/EMSMC-Service-Templates/EMSMC.Service.Templates.sln`. Match established conventions for project structure, DI registration, configuration, error handling, and testing. See `/home/franciscallahan/AGENTS.md` for the detailed pattern reference covering each layer (worker apps, Domain, Infrastructure, Feature Management, AWS messaging, secrets, tests).

## Pre-Dispatch Grill-Me Gate

Before dispatching parallel subagents (`{ tasks: [...] }` or `{ chain: [...] }`),
load and run the `pre-dispatch-grill-me` skill. This skill scans the user prompt
for `/grill-me`, "grill me", "adversarial review", and similar phrases. If found,
it runs the `grill-me` skill and feeds the adversarial findings into every
subagent task as context.

Do not skip this step. The user's intent to be grilled before parallel work is
part of the prompt, not a separate request.

## Claude CLI Dispatch

When the user says "use Claude subagents", "use Fable agents", or explicitly
asks to dispatch work through Claude Code, load and run the
`claude-cli-dispatch` skill. It invokes the `claude` CLI directly with an
explicit model and preserves the active authenticated profile; never add
`--bare`.

"Claude subagents" always means the Claude CLI, not PI subagents configured
with Claude models. Use Sonnet for routine review and Fable only for explicit
or high-impact adjudication, as defined by the routing gate below.

## Risk-Based Consolidated Changed-Code Review

Use one consolidated changed-code review at an implementation-slice or PR boundary when changes affect persistence or state transitions, migrations or database invariants, concurrency, security, public contracts, cross-platform automation, or broad cross-cutting behavior.

1. Before editing, capture the repository baseline, pre-existing dirty files, and files attributable to the task so the final review can be isolated.
2. Review only code changed by the current task. Read nearby unchanged code only for context and never broaden into unrelated work.
3. Include readability, maintainability, repository consistency, static-analysis compatibility, and language-specific checks from the `changed-code-review-checklist` skill in that same review. Do not run a separate style-review gate.
4. Skip reviewer dispatch for small localized changes, tests-only changes, direct copies of established repository patterns, and formatting or naming already enforced by configured analyzers when none of the risk categories above applies. The parent still owns focused validation and final-diff inspection.
5. Use Sonnet at high effort for the normal consolidated review. Use Fable only to adjudicate a concrete unresolved architecture, security, concurrency, data-integrity, conflicting-requirements, or unknown-root-cause question; never use it merely to repeat Sonnet's review.
6. Critical findings stop completion. High and Medium fixes receive at most one bounded follow-up review. Low findings are advisory; the parent may fix or defer them and verifies accepted fixes without launching another reviewer.
7. Do not run per-file or per-finding review loops, and do not add a separate verifier unless the first review leaves a disputed high-impact finding. If the consolidated reviewer is unavailable, perform the normal verification that remains possible and report the review limitation only when the risk criteria above required independent review.
