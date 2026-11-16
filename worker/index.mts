import { pool } from "../lib/platform/db.ts";
import {
  BUILD_JOB_TYPE,
  claimBuildJob,
  completeJob,
  failJob,
  pruneLogs,
  runBuildJob,
  runDeployment,
  type JobRow,
} from "../lib/platform/deployments.ts";
import { createAgentClient } from "../lib/agent-client.ts";
import { refreshAllOrganizationsUsage } from "../lib/platform/usage.ts";
import {
  BACKUP_JOB_TYPE,
  DAILY_BACKUP_UTC_HOUR,
  pruneBackups,
  runBackupJob,
  scheduleDailyBackups,
} from "../lib/platform/backups.ts";
import { pruneNodeHostMetrics, recordNodeHostMetrics } from "../lib/platform/host-metrics.ts";
import {
  pruneAdminMetrics,
  recordAdminDBMetrics,
  recordAdminRedisMetrics,
} from "../lib/platform/admin-metrics.ts";
import { RESTORE_JOB_TYPE, recoverStaleRestores, runRestoreJob } from "../lib/platform/restores.ts";
import { SCAN_JOB_TYPE, runScanJob } from "../lib/platform/scans.ts";
import {
  createDailyTask,
  createIntervalTask,
  workerLogger,
  type ScheduledTask,
} from "./scheduler.ts";
import { runJobWithHandler, type JobHandler } from "./job-registry.ts";

/**
 * Deployment worker. It runs as its own process from the same codebase, claims
 * one Build Job at a time with `FOR UPDATE SKIP LOCKED`, and lets the Node Agent
 * do the actual Build and container run. Build concurrency is therefore one per
 * node, as the spec requires, because a single worker handles one Job to
 * completion.
 */

const POLL_INTERVAL_MS = 1_000;

/**
 * How often the log-retention pass runs. Once an hour is enough to keep the
 * seven-day promise without deleting anything early: a line only becomes
 * eligible the moment it is a week old, and an hour of slack is harmless.
 */
const LOG_PRUNE_INTERVAL_MS = 60 * 60 * 1_000;

/**
 * How often the node's measured CPU, memory, and storage usage is stored. The
 * spec fixes this at five minutes; the Quota page also refreshes on open.
 */
const USAGE_REFRESH_INTERVAL_MS = 5 * 60 * 1_000;

/**
 * How often the worker asks each node for its own host sample. The dashboard
 * charts stay smooth at one sample per minute, and 24 hours of that fits in
 * 1440 rows per node.
 */
const HOST_METRICS_INTERVAL_MS = 60 * 1_000;

/** The worker's log line helper, mirroring workerLogger but multi-arg. */
const log = (message: string, extra?: string) => console.log(`[worker] ${message}`, extra ?? "");

/** Wraps a domain runner into the registry shape with its log subject. */
function handler(
  run: (job: JobRow) => Promise<{ status: string }>,
  subject: (job: JobRow) => string,
): JobHandler {
  return async (job) => ({ status: (await run(job)).status, subject: subject(job) });
}

const JOB_HANDLERS: Record<string, JobHandler> = {
  [BACKUP_JOB_TYPE]: handler(runBackupJob, (job) => String(job.payload.backupId ?? job.id)),
  [RESTORE_JOB_TYPE]: handler(runRestoreJob, (job) => String(job.payload.restoreId ?? job.id)),
  [SCAN_JOB_TYPE]: handler(runScanJob, (job) => String(job.payload.deploymentId ?? job.id)),
};

/**
 * The Build handler stays explicit: a Build that failed is terminal (retrying
 * would rebuild the same broken commit forever), a cancelled Deployment leaves
 * its Job row alone, and a produced image is run as the Service container.
 */
const BUILD_HANDLER: JobHandler = async (job) => {
  const deploymentId = job.payload.deploymentId;
  if (!deploymentId) {
    await failJob(job.id, "Build Job is missing its deploymentId.");
    return { status: "failed", subject: "unknown-deployment" };
  }

  const current = await pool.query<{ status: string }>(
    'SELECT "status" FROM "deployment" WHERE "id" = $1',
    [deploymentId],
  );
  if (!current.rowCount || current.rows[0].status === "cancelled") {
    await completeJob(job.id);
    return { status: "cancelled", subject: deploymentId };
  }

  try {
    const result = await runBuildJob(job);

    if (result.status === "failed") {
      await completeJob(job.id, "failed");
      workerLogger.log(`deployment ${deploymentId} build failed - ${result.message}`);
      return { status: "failed", subject: deploymentId };
    }
    if (result.status === "cancelled") {
      workerLogger.log(`deployment ${deploymentId} build cancelled`);
      return { status: "cancelled", subject: deploymentId };
    }

    // The Build produced an image. Run it as the Service container; the
    // Deployment only becomes `running` once the container answers its health
    // check, so a broken deployment never replaces a working one.
    const deployed = await runDeployment(deploymentId);
    await completeJob(job.id, deployed.status === "failed" ? "failed" : "succeeded");
    log(
      `deployment ${deploymentId} ${deployed.status}`,
      deployed.message ? `- ${deployed.message}` : "",
    );
    return { status: deployed.status, subject: deploymentId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failJob(job.id, message);
    workerLogger.error(`deployment ${deploymentId} job failed: ${message}`, error);
    return { status: "failed", subject: deploymentId };
  }
};

JOB_HANDLERS[BUILD_JOB_TYPE] = BUILD_HANDLER;

/**
 * Every background pass with its cadence. The loop body stays a flat list;
 * interval bookkeeping, immediate-first-run, and error logging live in the
 * task implementations.
 */
function backgroundTasks(): ScheduledTask[] {
  return [
    createIntervalTask("usage snapshots", USAGE_REFRESH_INTERVAL_MS, async () => {
      const refreshed = await refreshAllOrganizationsUsage();
      if (refreshed.snapshots > 0) {
        workerLogger.log(
          `stored ${refreshed.snapshots} usage snapshots for ${refreshed.organizations} Organizations`,
        );
      }
    }),

    createIntervalTask("host metrics", HOST_METRICS_INTERVAL_MS, async () => {
      const recorded = await recordNodeHostMetrics();
      if (recorded > 0) {
        workerLogger.log(`stored host metrics for ${recorded} node(s)`);
      }

      // The admin Overview polls in-process DB/Redis samples every 5s in
      // Forge; paas stores one sample per pass so history survives restarts.
      await recordAdminDBMetrics();
      await recordAdminRedisMetrics();
    }),

    createIntervalTask("retention pass", LOG_PRUNE_INTERVAL_MS, async () => {
      const logs = await pruneLogs();
      if (logs.lines > 0) {
        workerLogger.log(`pruned ${logs.lines} Build log lines older than seven days`);
      }

      // Host metrics share the hourly pass with the log prune, since a minute
      // of slack on a 24-hour retention window is harmless.
      const metrics = await pruneNodeHostMetrics();
      if (metrics > 0) {
        workerLogger.log(`pruned ${metrics} host metric rows older than 24 hours`);
      }

      // Admin metric samples share the same retention pass.
      const admin = await pruneAdminMetrics();
      if (admin > 0) {
        workerLogger.log(`pruned ${admin} admin metric rows older than 24 hours`);
      }
    }),

    // Backups are scheduled once a day at 02.00 UTC and pruned after seven
    // days. The first pass after a start runs immediately, and both calls are
    // idempotent, so a restart never schedules the same day twice.
    createDailyTask("daily Backup pass", DAILY_BACKUP_UTC_HOUR, async () => {
      const scheduled = await scheduleDailyBackups();
      if (scheduled.scheduled > 0) {
        workerLogger.log(`queued ${scheduled.scheduled} daily Backups`);
      }

      const pruned = await pruneBackups();
      if (pruned.removed > 0) {
        workerLogger.log(`pruned ${pruned.removed} Backups older than seven days`);
      }
    }),
  ];
}

let stopping = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loop(): Promise<void> {
  const tasks = backgroundTasks();

  while (!stopping) {
    for (const task of tasks) {
      await task.maybeRun(Date.now());
    }

    let job: JobRow | null = null;

    try {
      job = await claimBuildJob([BUILD_JOB_TYPE, BACKUP_JOB_TYPE, RESTORE_JOB_TYPE, SCAN_JOB_TYPE]);
    } catch (error) {
      workerLogger.error("could not claim a job", error);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!job) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    await runJobWithHandler(job, JOB_HANDLERS, {
      completeJob,
      failJob,
      log: workerLogger.log,
      error: workerLogger.error,
    });
  }
}

function shutdown(signal: string): void {
  console.log(`[worker] ${signal} received, finishing the current job before exiting`);
  stopping = true;
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

if (!process.env.AGENT_BASE_URL || !process.env.AGENT_TOKEN) {
  console.error("AGENT_BASE_URL and AGENT_TOKEN are required");
  process.exit(1);
}

// The agent client is created once so connection settings are validated at
// startup rather than in the middle of a Build.
createAgentClient(process.env.AGENT_BASE_URL.replace(/\/+$/, ""), process.env.AGENT_TOKEN);

console.log("[worker] deployment worker started");

// A Restore that was pending or running belongs to a worker that is no longer
// alive, because this is the only worker. Failing it here keeps the target from
// staying locked behind the active-Restore index.
try {
  const recovered = await recoverStaleRestores();
  if (recovered.failed > 0) {
    console.log(`[worker] failed ${recovered.failed} Restores interrupted by a restart`);
  }
} catch (error) {
  console.error("[worker] could not recover interrupted Restores", error);
}

await loop();
