---
description: Run an exhaustive but cost-aware task flow with conditional scouting, Astra implementation, Sonnet review, and Fable only for high-impact adjudication.
argument-hint: "<task>"
---
Orchestrate this task end-to-end using the smallest exhaustive route that establishes correctness.

Task: $ARGUMENTS

Execution policy:
1. Inspect the task and repository directly first. Launch at most one read-only DeepSeek Flash scout only when the relevant ownership remains unclear, multiple subsystems may own the behavior, the root cause is unknown, or broad discovery is genuinely required. Skip scouting when the task supplies exact files, findings, or an approved plan.
2. Use Fable before implementation only when a consequential architecture choice, conflicting requirement, security/concurrency/data-integrity uncertainty, or unknown root cause remains after focused inspection. Give it the one concrete unresolved question. Otherwise, the parent synthesizes the approach without a planning subagent.
3. Launch exactly one writer using `harness: "pi"`, `model: "openai-codex/gpt-6-astra"`, and `reasoning_effort: "high"`. Give it exact scope, relevant evidence, owned paths, and focused verification commands. Never run parallel writers in the same worktree.
4. When the final bounded diff meets the risk-based review gate, launch one fresh read-only reviewer using `harness: "claude"`, `model: "sonnet"`, and `reasoning_effort: "high"`. It must inspect the diff and relevant tests directly, try to disprove correctness, and report only actionable findings with exact references. Skip this reviewer for a small localized or tests-only change with no high-risk category.
5. If the Sonnet review finds High or Medium issues, use the same single-writer pattern to fix accepted findings and run one bounded Sonnet follow-up review. Low findings never trigger another review.
6. Use Fable after review only to adjudicate a disputed High/Critical architecture, security, concurrency, data-integrity, conflicting-requirements, or unknown-root-cause question. It must read the review artifact and inspect the relevant diff; it must not repeat the whole review.
7. Stop after one remediation/follow-up cycle. Report unresolved blockers instead of creating an open-ended review loop.
8. Do not use the Codex CLI harness. DeepSeek and Astra run through the Pi harness. Sonnet and Fable run through the Claude Code CLI harness using the active authenticated account.
9. The parent owns orchestration and final verification. Progress phases, file count, and the existence of multiple models do not independently justify more agents.

Return a concise final summary containing files changed, verification run, agents actually used with the reason for each, and residual risks.
