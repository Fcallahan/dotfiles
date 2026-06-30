import type { Workflow } from "./types.ts";

const defaultRuntime = {
  max_parallel_agents: 5,
  max_total_agents: 16,
  max_runtime_minutes: 45,
  default_model: "default",
  default_effort: "medium" as const,
  fail_fast: false,
};

export function codeReviewWorkflow(task = "Review the current branch"): Workflow {
  return {
    version: 1,
    name: "code-review",
    description: "Parallel code review with adversarial verification and synthesis.",
    input: { task, diff_base: { default: "HEAD" } },
    runtime: { ...defaultRuntime, max_parallel_agents: 5, max_total_agents: 12, max_runtime_minutes: 30 },
    context: { store: "sqlite", compression: { enabled: true, max_agent_result_tokens: 2000 } },
    phases: [
      {
        id: "discover",
        type: "agent",
        agent: "repo-mapper",
        prompt: "Analyze the current git diff and identify impacted subsystems, files, risks, and relevant tests.",
        output: "repo_map",
      },
      {
        id: "review",
        type: "parallel",
        depends_on: ["discover"],
        agents: ["security-reviewer", "db-reviewer", "test-reviewer", "architecture-reviewer"],
        input: { repo_map: "{{outputs.discover}}", diff: "{{artifacts.git_diff}}" },
        output: "findings",
      },
      {
        id: "verify",
        type: "agent",
        depends_on: ["review"],
        agent: "skeptic-reviewer",
        input: { findings: "{{outputs.review}}" },
        output: "verified_findings",
      },
      {
        id: "synthesize",
        type: "agent",
        depends_on: ["verify"],
        agent: "synthesizer",
        input: { findings: "{{outputs.verify}}" },
        output: "final_report",
      },
    ],
    gates: [
      { name: "evidence_required", applies_to: ["finding_report"], rule: "Every HIGH or CRITICAL finding must include file path, line range, and evidence." },
      { name: "no_uncommitted_surprise", applies_to: ["final"], rule: "Final report must include git status summary." },
    ],
    output: { format: "markdown", file: "final-report.md" },
  };
}

export function implementFeatureWorkflow(task = "Implement the requested change"): Workflow {
  return {
    version: 1,
    name: "implement-feature",
    description: "Plan, approve, implement in a worktree, test, review, and synthesize.",
    input: { task },
    runtime: { ...defaultRuntime, max_parallel_agents: 4, max_total_agents: 16, max_runtime_minutes: 60 },
    context: { store: "sqlite", compression: { enabled: true, max_agent_result_tokens: 2000 } },
    phases: [
      { id: "discover", type: "parallel", agents: ["repo-mapper", "architecture-reviewer", "test-reviewer"], output: "discovery" },
      {
        id: "plan",
        type: "agent",
        depends_on: ["discover"],
        agent: "planner",
        prompt: "Build an implementation plan from discovery. Do not modify files.",
        output: "implementation_plan",
      },
      { id: "approval", type: "gate", depends_on: ["plan"], gate: "user_approval" },
      {
        id: "implement",
        type: "agent",
        depends_on: ["approval"],
        agent: "implementation-agent",
        isolation: "worktree",
        input: { plan: "{{outputs.plan}}" },
        output: "patch_report",
      },
      { id: "test", type: "agent", depends_on: ["implement"], agent: "test-runner", input: { patch_report: "{{outputs.implement}}" }, output: "test_report" },
      {
        id: "review",
        type: "parallel",
        depends_on: ["test"],
        agents: ["security-reviewer", "db-reviewer", "architecture-reviewer"],
        input: { patch_report: "{{outputs.implement}}", test_report: "{{outputs.test}}" },
        output: "review_report",
      },
      { id: "synthesize", type: "agent", depends_on: ["review"], agent: "synthesizer", output: "final_report" },
    ],
    gates: [
      { name: "plan_approval", required_before: ["write_file", "apply_patch", "shell_mutating"] },
      { name: "test_gate", applies_to: ["implementation"], rule: "Run relevant tests before final response." },
      { name: "no_uncommitted_surprise", applies_to: ["final"], rule: "Final report must include git status summary." },
    ],
    output: { format: "markdown", file: "final-report.md" },
  };
}

export function migrationAuditWorkflow(task = "Audit migrations and schema changes"): Workflow {
  return {
    version: 1,
    name: "migration-audit",
    description: "Parallel database migration audit with adversarial synthesis.",
    input: { task },
    runtime: { ...defaultRuntime, max_parallel_agents: 6, max_total_agents: 18, max_runtime_minutes: 45 },
    context: { store: "sqlite", compression: { enabled: true, max_agent_result_tokens: 2000 } },
    phases: [
      { id: "discover_schema", type: "parallel", agents: ["repo-mapper", "db-reviewer", "architecture-reviewer"], output: "schema_context" },
      {
        id: "migration_risk_review",
        type: "parallel",
        depends_on: ["discover_schema"],
        agents: ["migration-reviewer", "data-integrity-reviewer", "rollback-reviewer", "test-reviewer"],
        output: "migration_findings",
      },
      { id: "adversarial", type: "agent", depends_on: ["migration_risk_review"], agent: "skeptic-reviewer", output: "verified_findings" },
      { id: "synthesize", type: "agent", depends_on: ["adversarial"], agent: "synthesizer", output: "final_report" },
    ],
    gates: [
      { name: "evidence_required", applies_to: ["finding_report"], rule: "Every HIGH or CRITICAL finding must include file path, line range, and evidence." },
      { name: "adversarial_review", applies_to: ["high_risk_workflow"], rule: "Skeptic agent must review findings before final output." },
    ],
    output: { format: "markdown", file: "final-report.md" },
  };
}

export function classifyTask(task: string): { workflow: Workflow; reason: string; requiresWorkflow: boolean; type: string } {
  const lower = task.toLowerCase();
  const isReview = /\b(review|audit|pr|branch|diff|security|correctness|test gaps?)\b/.test(lower);
  const isMutation = /\b(implement|build|add|fix|change|refactor|migrate|move|convert|update|create)\b/.test(lower);
  const isMigration = /\b(migration|migrate|schema|database|sql|postgres|sql server|ef core|billing_rules?)\b/.test(lower);

  if (isMigration && !isMutation || (isMigration && isReview)) {
    return { workflow: migrationAuditWorkflow(task), reason: "Database/schema task benefits from specialized migration, data-integrity, rollback, and test review.", requiresWorkflow: true, type: "migration_audit" };
  }
  if (isMutation) {
    return { workflow: implementFeatureWorkflow(task), reason: "Implementation task benefits from discovery, plan approval, isolated mutation, validation, and review.", requiresWorkflow: true, type: "implementation" };
  }
  return { workflow: codeReviewWorkflow(task), reason: isReview ? "Review/audit task benefits from parallel specialist reviewers and adversarial synthesis." : "Explicit workflow request benefits from decomposition and durable run state.", requiresWorkflow: true, type: "code_review" };
}

export const templateFactories = {
  "code-review": codeReviewWorkflow,
  "implement-feature": implementFeatureWorkflow,
  "migration-audit": migrationAuditWorkflow,
};

export function getTemplate(name: string, task = name): Workflow | undefined {
  return templateFactories[name as keyof typeof templateFactories]?.(task);
}
