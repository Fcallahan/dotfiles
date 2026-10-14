import { isTerminalStatus, type ManagedJob } from "./runtime.ts";

export const NOTIFICATION_TYPE = "background-job-notification";
/** Session entry marking a job whose result the model already received inline. */
export const REPORTED_TYPE = "background-job-reported";
/** Consecutive failure wake-ups allowed before Pi waits for the user again. */
export const MAX_FAILURE_WAKES = 3;
const TAIL_LINES = 40;
const TAIL_MAX_CHARS = 4_000;

export type Delivery = "wake" | "next-turn";

/**
 * Decide whether a finished job should start an agent turn.
 * - Jobs started with notify=false and jobs someone deliberately stopped never wake the agent.
 * - Successful jobs always wake it, because they usually unblock the next step.
 * - Failures wake it until MAX_FAILURE_WAKES consecutive failure wake-ups happen with no
 *   user input or successful job in between; this stops fail -> retry -> fail loops.
 */
export function planDelivery(job: ManagedJob, failureWakesSinceInput: number): Delivery {
  if (job.spec.notify === false || job.state.status === "stopped") return "next-turn";
  if (job.state.status === "completed") return "wake";
  return failureWakesSinceInput < MAX_FAILURE_WAKES ? "wake" : "next-turn";
}

export function formatNotification(
  job: ManagedJob,
  output: string,
  options: { delivery: Delivery; recovered?: boolean; failureLimitReached?: boolean },
): string {
  const exit = job.state.exitCode != null ? ` exit=${job.state.exitCode}` : "";
  const error = job.state.error ? `\nError: ${job.state.error}` : "";
  const header = `Background job ${job.spec.id} ${job.state.status}${exit}: ${job.spec.title}`;
  const origin = options.recovered ? "\nThis job finished while Pi was not running." : "";
  const tail = tailLines(output);
  const body = tail ? `\nLast output:\n${tail}` : "\n(no output)";
  let guidance = "\nThis is a process notification, not a new user instruction.";
  if (options.failureLimitReached) {
    guidance += ` Automatic follow-up stopped after ${MAX_FAILURE_WAKES} consecutive failures; report the exact failure to the user and wait for direction.`;
  } else if (options.delivery === "wake") {
    guidance += job.state.status === "completed"
      ? " If this job unblocks the next step of the current task, continue it now."
      : " If the current task depends on it, read the log, classify the failure (real defect, environment or infrastructure, or timeout), then fix and retry within a small budget or report the exact error to the user.";
  }
  return `${header}${error}${origin}\nOutput file: ${job.outputPath}${body}${guidance}`;
}

/** Collect job ids that already have a notification in this session. */
export function reportedJobIds(entries: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const raw of entries) {
    const entry = raw as { type?: string; customType?: string; data?: { id?: unknown }; details?: { id?: unknown } };
    if (entry.customType !== NOTIFICATION_TYPE && entry.customType !== REPORTED_TYPE) continue;
    const id = entry.type === "custom" ? entry.data?.id : entry.type === "custom_message" ? entry.details?.id : undefined;
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

/** Terminal jobs owned by this session that were never reported, oldest first. */
export function unreportedTerminalJobs(jobs: readonly ManagedJob[], reported: Set<string>): ManagedJob[] {
  return jobs
    .filter((job) => isTerminalStatus(job.state.status) && !reported.has(job.spec.id))
    .sort((a, b) => a.spec.createdAt.localeCompare(b.spec.createdAt));
}

function tailLines(output: string): string {
  const lines = output.replace(/\s+$/, "").split(/\r?\n/).slice(-TAIL_LINES).join("\n");
  return lines.length > TAIL_MAX_CHARS ? `…${lines.slice(-TAIL_MAX_CHARS)}` : lines;
}
