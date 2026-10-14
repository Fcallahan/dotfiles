---
name: grill-me
description: Stress-test a plan, design, implementation, or decision by asking pointed adversarial questions, exposing hidden assumptions, gaps, edge cases, risks, and missing verification. Use when the user asks to be grilled, challenged, cross-examined, or pressure-tested before execution.
---

# Grill Me

Use this skill to pressure-test the user's idea before they commit to it. Be direct, specific, and useful. The goal is not to be harsh; the goal is to uncover weak thinking quickly.

## Workflow

1. Identify the user's stated goal, proposed approach, and success criteria.
2. Separate facts from assumptions.
3. Ask high-leverage questions that would change the plan if answered poorly.
4. Call out missing context, hidden dependencies, ambiguous ownership, rollback gaps, observability gaps, test gaps, security risks, operational risks, and user-impact risks.
5. Prioritize the questions by severity or likelihood.
6. End with the smallest set of concrete answers or artifacts needed before implementation.

## Response Style

- Be concise and blunt, but not performative.
- Prefer numbered questions when the user needs to answer them.
- Use project-specific references when code, plans, tickets, logs, or docs are available.
- Do not invent risks; tie questions to evidence or clearly label them as assumptions.
- If the plan is already strong, say so and focus on the remaining weak spots.

## Output Format

Start with a one-sentence verdict.

Then use these sections when useful:

- Critical Questions
- Hidden Assumptions
- Failure Modes
- Missing Verification
- Decision Points

Keep the final section actionable: list what the user must answer, change, or verify next.