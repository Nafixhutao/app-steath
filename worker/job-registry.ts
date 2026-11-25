import type { JobRow } from "../lib/platform/deployments.ts";

export type JobOutcome = "succeeded" | "failed" | "cancelled";

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

export type JobQueueIo = {
  completeJob: (id: string, outcome?: JobOutcome) => Promise<void>;
  failJob: (id: string, message: string) => Promise<void>;
  log: (message: string) => void;
  error: (message: string, error: unknown) => void;
};

/**
 * Dispatches one claimed Job through its handler. The wrapper owns the
 * complete/fail bookkeeping and the log lines, so a handler only decides what
 * its Job does. A Job type without a handler is completed as failed rather
 * than retried forever.
 */
export async function runJobWithHandler(
  job: JobRow,
  handlers: Record<string, JobHandler>,
  io: JobQueueIo,
): Promise<void> {
  const handler = handlers[job.type];

  if (!handler) {
    await io.completeJob(job.id, "failed");
    io.log(`no handler for Job type ${job.type}, completed as failed`);
    return;
  }

  try {
    const result = await handler(job);
    const outcome =
      result.status === "failed"
        ? "failed"
        : result.status === "cancelled"
          ? "cancelled"
          : "succeeded";
    await io.completeJob(job.id, outcome);
    io.log(`${job.type} ${result.subject} ${result.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await io.failJob(job.id, message);
    io.error(`${job.type} job failed: ${message}`, error);
  }
}
