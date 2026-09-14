---
name: changed-code-review-checklist
description: Language-specific C#, Python, and shell quality checklist to fold into one consolidated review of a substantial or risky changed-code slice. Do not run as a standalone completion gate.
metadata:
  status: ready
---

# Changed-Code Review Checklist

## Purpose

Add readability, maintainability, repository consistency, static-analysis compatibility, and language-specific engineering checks to an already warranted consolidated code review. This checklist is not a separate reviewer or completion gate.

Optimize for correctness and human comprehension rather than minimum line count, maximum abstraction, or clever syntax. Treat the rules as engineering heuristics, not mechanical laws.

## When to include it

Include this checklist in one consolidated review when changed C#, Python, or shell code is part of a bounded diff that affects:

- persistence, state transitions, migrations, or database invariants;
- concurrency or security;
- public contracts or cross-repository behavior;
- cross-platform automation;
- broad cross-cutting behavior that focused tests cannot cover confidently;
- an explicit user review request.

Do not dispatch a reviewer solely for this checklist. Skip independent review for small localized changes, tests-only changes, direct copies of established repository patterns, and formatting or naming already enforced by configured analyzers. The parent still runs focused validation and inspects the final diff.

## Review scope

The review request should provide:

```text
Task summary:
Requirements or acceptance criteria:
Repository or worktree root:
Baseline captured before implementation:
Changed files attributable to this task:
New files attributable to this task:
Scoped diff or diff artifact:
Applicable repository instructions:
Validation already run:
```

Use the first trustworthy scope source available:

1. A before-and-after implementation manifest maintained by the parent.
2. An explicit baseline commit or tree when the worktree was confirmed clean before implementation.

Fail closed when current-task changes cannot be separated from pre-existing changes. Do not broaden the review to the complete working-tree or branch diff.

- Evaluate added and modified lines.
- Treat every line of a newly created source file as changed.
- Read nearby unchanged code only to understand the change.
- Report unchanged code only when the current change directly creates, depends on, or exposes the problem.
- Exclude generated files and generated migration files unless manually changed.
- Do not attribute unrelated formatter, analyzer, build, or test failures to the implementation.

## Repository precedent

Inspect comparable repository examples when they exist. When repository convention conflicts with a general rule:

1. Preserve the convention when it is intentional, safe, and current.
2. Prefer the rule only when the precedent is demonstrably unsafe, obsolete, or conflicts with higher-priority instructions.
3. Do not report a convention-following change as a finding merely because another name or structure is also reasonable.

## Language references

Read the complete reference for every changed language in scope:

- C#: [references/csharp-code-quality-rules.md](references/csharp-code-quality-rules.md)
- Python and shell: [references/script-code-quality-rules.md](references/script-code-quality-rules.md)

The checks include naming and domain intent, control flow, responsibilities, dependencies, duplication, null handling, collections, async and cancellation, EF Core and data access, logging, error handling, tests, shell safety, Python maintainability, and cross-platform behavior.

Apply a rule only when the problem is concrete and the smallest fix is proportionate. Correctness, security, data integrity, and operational failures belong in the same consolidated report rather than being split into a second review.

## Finding standard

Report a finding only when all are true:

- A specific requirement, rule, or safe repository convention is violated.
- The problem is in changed code or directly caused by it.
- The reviewer can cite an exact file and line.
- The impact has a plausible, concrete failure path or maintenance cost.
- The smallest safe fix is clear and proportionate.

Do not report:

- Personal preferences unsupported by requirements or repository convention.
- Existing issues unrelated to the implementation.
- Hypothetical concerns without a plausible consequence.
- Formatting already handled by the configured formatter or analyzer.
- Suggestions that create speculative abstractions or expand the task.
- A copied repository pattern unless evidence shows the pattern is unsafe in this use.
- Duplicate symptoms of one root cause; consolidate them at the highest applicable severity.

## Severity and follow-up

- **Critical:** Data loss, a security breach, severe corruption, or production-wide failure. Stop completion.
- **High:** Likely incorrect, unsafe, non-translatable, operationally dangerous, or a required-boundary violation.
- **Medium:** A concrete maintainability, testability, performance, or consistency problem worth fixing before completion.
- **Low:** A localized improvement with small but real value. Advisory only.

After fixes:

- Critical findings remain a stop condition until independently resolved.
- High and Medium fixes receive one bounded follow-up review.
- Low findings never trigger another reviewer pass. The parent verifies accepted Low fixes with the final diff and focused checks.
- Do not start per-finding or repeated closure loops.

## Validation

Use repository-specific commands and start with the narrowest useful checks. Examples include:

```text
dotnet format --verify-no-changes
dotnet build
dotnet test
bash -n path/to/script.sh
shellcheck path/to/script.sh
python3 -m py_compile path/to/script.py
```

Identify the actual solution, project, scripts, and dependency state first. Record commands, exit codes, and concise results. Separate failures caused by the scoped implementation from unrelated failures.

## Output

Use the normal consolidated code-review format. Do not create a separate style-review artifact. Include language-quality findings alongside correctness, security, data-integrity, performance, deployment, and test findings, ordered by severity.
