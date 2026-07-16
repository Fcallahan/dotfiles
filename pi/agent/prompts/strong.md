---
description: Orchestrate a task with Deepseek scouting, Fable investigation, Sol implementation, and fresh adversarial review cycles.
argument-hint: "<task>"
---
Orchestrate this task end-to-end using mixed-harness spawned subagents.

Task: $ARGUMENTS

Execution policy:
1. Scout first with cheap models. Launch one or more parallel read-only `subagent_spawn` agents using `harness: "pi"`, `model: "deepseek/deepseek-v4-flash"`, and `reasoning_effort: "low"` to map the territory relevant to the task. Scouting is retrieval, not reasoning — low effort keeps scouts fast; do not raise it. Scouts must INDEX, never summarize: each scout returns a context pack — relevant files with a one-line role each, key symbols with line ranges, dependency/call edges between them, and short VERBATIM snippets of load-bearing code. Scouts must not paraphrase logic, must not editorialize, and must not make recommendations; their job is to tell the investigator where to look, not what to think. Skip this step only when the task already names the exact files involved and they are few — then go straight to step 2.
2. Investigate with one or more fresh `subagent_spawn` agents using `harness: "claude"` and `model: "fable"`. Keep investigators read-only. Pass each investigator the scouts' context packs verbatim. The investigator must treat the pack as a map, not as ground truth: it keeps full read access, and must directly read the files the pack flags as central before reaching conclusions. It returns evidence, risks, and a recommended implementation approach. Spend Fable's budget on judgment over the code that matters, not on discovery the scouts already did.
3. Synthesize the investigation into concrete implementation instructions and launch exactly one writer using `harness: "pi"`, `model: "openai-codex/gpt-5.6-sol"`, and `reasoning_effort: "low"`. The Sol agent must implement in the current worktree and run the narrowest useful tests. Include the relevant slice of the context pack (file list + line pointers) in the writer's instructions so it does not re-discover the territory.
4. After implementation, launch a NEW fresh-context adversarial reviewer using `harness: "claude"` and `model: "fable"`. The reviewer must inspect the resulting diff and relevant tests directly, try to disprove correctness, and report only actionable findings with exact file references. It must not edit files.
5. If material findings remain, launch a NEW Sol writer with the same Pi harness/model/reasoning settings to apply the feedback and rerun relevant tests. Then launch another NEW Fable adversarial reviewer. Repeat this review-remediation cycle until the task requirements are met, tests pass, and a fresh reviewer finds no material unresolved issue.
6. Allow at most three remediation cycles. If the work does not converge, stop and report the unresolved blockers instead of looping indefinitely.
7. Keep only one writing agent active at a time. Parallelize read-only scouting and investigation when useful, but never launch parallel writers into the same worktree.
8. Do not use the Codex CLI harness. "Scout" means the `deepseek/deepseek-v4-flash` model (OpenRouter) through the Pi harness. "Sol" means the `openai-codex/gpt-5.6-sol` model through the Pi harness. "Fable" means the Claude Code harness using the logged-in Claude subscription.
9. The parent agent owns orchestration: wait for each required phase, pass concrete outputs to the next agent, independently inspect the final diff, and run final verification before claiming completion.

Return a concise final summary containing files changed, verification run, review-cycle count, and any residual risks.
