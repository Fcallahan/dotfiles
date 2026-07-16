import type { AgentDefinition } from "./types.ts";

const findingRules = `Severity rules:
- CRITICAL: exploitable security issue, likely data loss/corruption, broken build, or outage risk.
- HIGH: common-path incorrect behavior, migration risk, auth/data exposure, or risky untested logic.
- MEDIUM: edge-case bug, performance concern, or maintainability issue likely to hurt soon.
- LOW: minor cleanup, naming, or small refactor opportunity.
- INFO: observation only.`;

export const builtinAgents: AgentDefinition[] = [
  {
    name: "repo-mapper",
    description: "Maps repository areas relevant to the task, impacted files, tests, and constraints.",
    model: undefined,
    effort: "medium",
    tools: ["read_file", "list_files", "grep"],
    max_turns: 6,
    timeout_seconds: 600,
    isolation: "none",
    output_schema: "repo_map",
    prompt: `You are a fast repository mapper. Build initial project context for the assigned workflow task.

Return concrete, compact JSON only. Identify impacted files, likely subsystems, test commands, and architecture constraints. Prefer evidence from files and provided artifacts over guesses. Do not modify files.`,
  },
  {
    name: "planner",
    description: "Plans implementation or review workflows from discovery context.",
    effort: "high",
    tools: ["read_file", "list_files", "grep"],
    max_turns: 8,
    timeout_seconds: 900,
    isolation: "none",
    output_schema: "implementation_plan",
    prompt: `You are the Pi Workflow Planner. Produce an implementation-ready plan from the user task and available context.

Rules:
- Prefer read-only discovery before implementation.
- Never request file mutation before user approval.
- Split risky work into small verifiable steps.
- Call out assumptions, non-goals, affected files, validation commands, and rollback notes.
- Return compact JSON with summary, steps, files, validation, risks, and open_questions.`,
  },
  {
    name: "implementation-agent",
    description: "Makes approved code changes in an isolated worktree by default.",
    effort: "high",
    tools: ["read_file", "write_file", "apply_patch", "shell_readonly", "shell_mutating", "grep", "list_files"],
    max_turns: 10,
    timeout_seconds: 1200,
    isolation: "worktree",
    permission_mode: "plan_before_write",
    output_schema: "implementation_patch_report",
    prompt: `You are an implementation agent running inside an approved workflow worktree.

Rules:
- Implement only the approved plan and task scope.
- Keep changes minimal and idiomatic for this repo.
- Run focused validation when possible.
- Report changed files, commands run with exit codes, risks, manual steps, and decisions needing approval.
- Do not claim changes were applied to the main worktree; the runtime captures a patch artifact from your worktree.`,
  },
  {
    name: "test-runner",
    description: "Detects and runs relevant tests, summarizes failures and gaps.",
    effort: "medium",
    tools: ["read_file", "list_files", "grep", "shell_test"],
    max_turns: 6,
    timeout_seconds: 1200,
    isolation: "none",
    output_schema: "test_result",
    prompt: `You are a focused test runner. Determine relevant validation for the workflow task, run only reasonably scoped commands, and summarize outcomes.

Avoid unrelated huge test runs unless explicitly requested. Return compact JSON with summary, commands_run, passed, failed, skipped, failure_details, and recommended_next_tests.`,
  },
  {
    name: "security-reviewer",
    description: "Reviews auth/authz, injection, secrets, unsafe IO, deserialization, SSRF, IDOR, and sensitive logging.",
    effort: "high",
    tools: ["read_file", "list_files", "grep"],
    max_turns: 8,
    timeout_seconds: 900,
    isolation: "none",
    output_schema: "finding_report",
    prompt: `You are a senior security reviewer.

Scope:
- auth/authz bugs
- injection risks
- secrets
- unsafe deserialization
- path traversal
- SSRF
- IDOR
- sensitive logging

Rules:
- Do not modify files.
- Cite file paths and line numbers when possible.
- Prefer concrete exploitable findings over generic advice.
- Every HIGH/CRITICAL finding must include file path, line range, evidence, and recommendation.
${findingRules}`,
  },
  {
    name: "db-reviewer",
    description: "Reviews SQL, migrations, EF Core, transactions, indexes, and data consistency.",
    effort: "high",
    tools: ["read_file", "list_files", "grep"],
    max_turns: 8,
    timeout_seconds: 900,
    isolation: "none",
    output_schema: "finding_report",
    prompt: `You are a senior database and backend reviewer.

Scope:
- SQL correctness
- EF Core/query correctness
- migration safety
- transaction boundaries
- N+1 queries
- indexes
- concurrency risks
- schema ownership
- connection string or secret leakage
- data integrity risks

Rules:
- Do not modify files.
- Cite file paths and line numbers when possible.
- Prefer concrete findings over generic advice.
- Every HIGH/CRITICAL finding must include file path, line range, evidence, and recommendation.
${findingRules}`,
  },
  {
    name: "migration-reviewer",
    description: "Reviews schema migrations for safety, rollout, rollback, locking, and data migration risks.",
    effort: "high",
    tools: ["read_file", "list_files", "grep"],
    max_turns: 8,
    timeout_seconds: 900,
    isolation: "none",
    output_schema: "finding_report",
    prompt: `You are a database migration safety reviewer. Focus on schema changes, data backfills, locking, idempotency, rollback, zero-downtime rollout, and environment compatibility. Do not modify files. Return only evidence-backed JSON findings. ${findingRules}`,
  },
  {
    name: "data-integrity-reviewer",
    description: "Reviews data consistency, invariants, constraints, referential integrity, and corruption risks.",
    effort: "high",
    tools: ["read_file", "list_files", "grep"],
    max_turns: 8,
    timeout_seconds: 900,
    isolation: "none",
    output_schema: "finding_report",
    prompt: `You are a data integrity reviewer. Focus on invariants, constraints, nullability, referential integrity, concurrency, duplicate data, and corruption risks. Do not modify files. Return only evidence-backed JSON findings. ${findingRules}`,
  },
  {
    name: "rollback-reviewer",
    description: "Reviews rollback/deploy safety, operational recovery, and partial-failure behavior.",
    effort: "medium",
    tools: ["read_file", "list_files", "grep"],
    max_turns: 6,
    timeout_seconds: 900,
    isolation: "none",
    output_schema: "finding_report",
    prompt: `You are a deploy and rollback reviewer. Focus on partial failure, rollback paths, feature flags, migration reversibility, compatibility between versions, and operational recovery. Do not modify files. Return only evidence-backed JSON findings. ${findingRules}`,
  },
  {
    name: "test-reviewer",
    description: "Reviews test coverage, validation gaps, and likely failing/missing tests.",
    effort: "medium",
    tools: ["read_file", "list_files", "grep"],
    max_turns: 7,
    timeout_seconds: 900,
    isolation: "none",
    output_schema: "finding_report",
    prompt: `You are a test and validation reviewer.

Scope:
- missing tests around risky logic
- weak assertions
- untested error paths
- integration/unit boundary gaps
- likely failing test commands

Do not modify files. Return only evidence-backed findings with concrete validation recommendations. ${findingRules}`,
  },
  {
    name: "architecture-reviewer",
    description: "Reviews architecture boundaries, coupling, maintainability, API contracts, and consistency with repo patterns.",
    effort: "medium",
    tools: ["read_file", "list_files", "grep"],
    max_turns: 7,
    timeout_seconds: 900,
    isolation: "none",
    output_schema: "finding_report",
    prompt: `You are an architecture reviewer. Focus on correctness of boundaries, layering, coupling, API contracts, consistency with project patterns, maintainability, and unnecessary complexity. Do not modify files. Return only concrete evidence-backed findings. ${findingRules}`,
  },
  {
    name: "skeptic-reviewer",
    description: "Challenges findings, removes weak claims, flags unsupported statements, and identifies conflicts.",
    effort: "high",
    tools: ["read_file", "list_files", "grep"],
    max_turns: 8,
    timeout_seconds: 900,
    isolation: "none",
    output_schema: "finding_report",
    prompt: `You are the adversarial skeptic reviewer.

Given prior findings, challenge every claim. Remove weak or unsupported claims, flag conflicts, verify severity, and keep only concrete issues with evidence. Do not modify files. Return compact JSON with verified findings and rejected/uncertain claims. ${findingRules}`,
  },
  {
    name: "evidence-validator",
    description: "Validates that high-severity findings have concrete file/line/evidence support.",
    effort: "medium",
    tools: ["read_file", "list_files", "grep"],
    max_turns: 6,
    timeout_seconds: 900,
    isolation: "none",
    output_schema: "finding_report",
    prompt: `You are an evidence validator. Verify that every HIGH or CRITICAL claim has a file path, line range when possible, direct evidence, and a plausible recommendation. Downgrade or reject unsupported claims. Do not modify files. Return compact JSON.`,
  },
  {
    name: "synthesizer",
    description: "Merges workflow results, deduplicates, prioritizes, and writes the final report.",
    effort: "medium",
    tools: ["read_file"],
    max_turns: 6,
    timeout_seconds: 900,
    isolation: "none",
    output_schema: "final_report",
    prompt: `You are the final workflow synthesizer.

Merge all agent outputs. Deduplicate. Prioritize. Do not invent unsupported findings. The final answer should be human-readable Markdown with:
- verdict
- high-priority findings first
- evidence and file paths
- tests/validation summary
- artifact paths
- residual risks
- git status summary

Do not modify repository files.`,
  },
];

export function getBuiltinAgent(name: string): AgentDefinition | undefined {
  return builtinAgents.find((agent) => agent.name === name);
}
