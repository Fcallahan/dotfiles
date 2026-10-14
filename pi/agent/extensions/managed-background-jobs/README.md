# managed-background-jobs

Runs shell commands as durable, supervised background jobs so a slow build, test
suite, or monitor never blocks the foreground Pi conversation - and stays visible
while it runs.

## What you get

- **`managed_bash` tool** - the LLM's way to run a command as a managed job
  (foreground by default, or `run_in_background=true`). State (`spec.json`,
  `state.json`, rotated `output.log`) lives under
  `~/.pi/agent/background-jobs/job-<id>/` and survives Pi restarts.
- **`background_jobs` tool** - list/status/logs/wait/stop/restart/cleanup for the LLM.
  `action=wait` blocks up to `timeout_seconds` (default 600) for a short
  dependency; the job keeps running if the wait ends first.
- **Live footer status** - while any job started in the current Pi session is
  still running, the footer shows a compact line like:

  ```
  ⚙ 2 background jobs (build 3m12s, review-agent 1m04s)
  ```

  Up to 3 jobs are named inline (title + elapsed time); extras collapse to
  `+N more`. The line disappears once nothing is running.
- **Completion wake-ups** - when a background job finishes, Pi sends the model
  a `background-job-notification` message (status, exit code, error, last 40
  lines of output) with `triggerTurn: true, deliverAs: "steer"`. An idle agent
  starts a turn; a busy agent receives it at its next tool boundary. The TUI
  also shows a toast and a transcript line.
  - Jobs started with `notify=false`, and jobs someone stopped, are recorded in
    context without starting a turn.
  - Failures wake the agent at most 3 times in a row. After that they are
    recorded without a turn until a person types (`input` event) or a job
    succeeds, which stops fail -> retry -> fail loops.
  - Foreground runs and `background_jobs action=wait` already return the
    result inline, so they are not reported again.
- **Resume recovery** - on `session_start`, terminal jobs owned by the session
  that have no notification in the session log (for example, they finished
  while Pi was closed) are reported once, without starting a turn.
- **Works without a UI** - transition detection runs in TUI, RPC, and headless
  modes; only the footer and toasts need a UI.
- **`Ctrl+B`** - move an in-flight *foreground* `managed_bash` call to the
  background without losing it.

## `/jobs` command

- `/jobs` - list all managed jobs (id, status, title, pid/exit code, elapsed
  or total run time, cwd, output path), newest first.
- `/jobs <id>` - status plus the last 40 lines of that job's output.
- `/jobs <id> <n>` - status plus the last `<n>` lines of output.

This is the same data the `background_jobs` tool exposes to the LLM, just
reachable directly from the editor.

## Notes

- Elapsed/run time (`elapsed=` while running, `ran=` once finished) comes from
  `state.json`'s `startedAt`/`finishedAt` fields - see `formatJob` and
  `jobElapsedMs` in `runtime.ts`.
- The footer status and completion notifications only cover jobs whose
  `spec.sessionId` matches the current Pi session; jobs from other sessions
  still show up in `/jobs` and the `background_jobs` tool.
- Tests: `node --experimental-strip-types --test notifications.test.ts runtime.test.ts index.test.ts`.
  `index.test.ts` loads the extension against a fake Pi API and resolves Pi
  packages from `PI_CODING_AGENT_ROOT` (default: the global npm install).
- Polling is a single 1s interval per session, and it only runs while at
  least one job for that session is still active - it starts itself when a
  job begins and stops itself once nothing is running (see `ensurePoller` /
  `stopPoller` in `index.ts`).
