import type { JobRow } from "../lib/platform/deployments.ts";

/**
 * The outcome a job handler reports back to the queue bookkeeping.
 * `jobStatus` feeds `completeJob`: a handler that finished its work but found
 * the underlying operation failed (a broken Build, a failed Restore) marks the
 * Job failed without going through the retry backoff that `failJob` implies.
 */
export interface JobResult {
  status: string;
  /** What the worker log line shows, e.g. the backup or deployment id. */
  subject: string;
}

/**
 * One handler per Job type. Handlers own their domain logic (imported from
 * `lib/platform/*`); the worker's dispatch and error handling stay generic.
 */
export type JobHandler = (job: JobRow) => Promise<JobResult>;

export class UnknownJobTypeError extends Error {
  constructor(readonly jobType: string) {
    super(`No handler for Job type ${jobType}`);
  }
}

/**
 * Dispatches one claimed Job through its handler. The wrapper owns the
 * complete/fail bookkeeping and the log lines, so a handler only decides what
 * its Job does. A Job type without a handler is completed as failed rather
 * than retried forever.
 */
export async function runJobWithHandler(
  job: JobRow,
  handlers: Record<string, JobHandler>,
  io: {
    completeJob: (id: string, status?: string) => Promise<void>;
    failJob: (id: string, message: string) => Promise<void>;
    log: (message: string) => void;
    error: (message: string, error: unknown) => void;
  },
): Promise<void> {
  const handler = handlers[job.type];

  if (!handler) {
    await io.completeJob(job.id, "failed");
    io.log(`no handler for Job type ${job.type}, completed as failed`);
    return;
  }

  try {
    const result = await handler(job);
    await io.completeJob(job.id, result.status === "failed" ? "failed" : "succeeded");
    io.log(`${job.type} ${result.subject} ${result.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await io.failJob(job.id, message);
    io.error(`${job.type} job failed: ${message}`, error);
  }
}
