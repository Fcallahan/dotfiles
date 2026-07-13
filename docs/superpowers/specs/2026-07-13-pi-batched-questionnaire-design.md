# Pi Batched Questionnaire Design

## Goal

Reduce interruption cycles when Pi needs clarification. Pi should gather all foreseeable uncertainties first, present them in one prepared batch, collect the answers in a continuous terminal wizard, and only then resume reasoning or implementation.

## Behavior

- Keep the existing `question` tool for a genuinely singular decision.
- Add a `questionnaire` tool for two or more foreseeable questions.
- The questionnaire tool receives the complete question batch in one tool call. This guarantees Pi prepares the batch before user interaction begins.
- Show one question at a time with progress such as `Question 2 of 5`.
- Selecting an answer advances automatically.
- Users can move backward to revise earlier answers.
- After all questions are answered, show a review screen and require one final submission.
- Return all answers to Pi together. Pi resumes work only after submission.
- Ring the terminal bell once immediately before either question UI opens.
- Do not send desktop notifications.

## Agent Guidance

Tool metadata will explicitly instruct Pi to:

1. Identify all foreseeable clarification needs before prompting.
2. Use one questionnaire when there are two or more questions.
3. Avoid serial follow-up questions unless an earlier answer exposes a genuinely new unknown.
4. Avoid filler questions; the batch may contain any necessary number of questions rather than forcing three to five.

## Implementation

- Add `pi/agent/extensions/questionnaire/index.ts`, based on Pi's official questionnaire extension.
- Adapt its tab-oriented interface into a linear wizard with progress, backward navigation, automatic advancement, and final review.
- Add a terminal bell write (`\x07`) immediately before opening the custom UI.
- Add the same bell behavior to `pi/agent/extensions/question/index.ts`.
- Preserve custom free-text answers and option descriptions.
- Treat empty question arrays and non-TUI execution as errors without ringing.
- Cancellation returns a cancelled result and no partial answers to the agent as confirmed input.

## Verification

- Type-check or load both extensions through Pi without startup errors.
- Exercise one single-question prompt and confirm one bell.
- Exercise a three-question batch and confirm:
  - one bell for the batch,
  - sequential progress,
  - backward answer revision,
  - final review,
  - all answers returned together.
- Confirm non-interactive mode returns a UI-unavailable error.

## Scope

No desktop notification, persistent notification settings, arbitrary form fields, or changes to unrelated Pi extensions are included.
