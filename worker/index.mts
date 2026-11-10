import { Pool } from "pg";
import {
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

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let stopping = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs one claimed Job. A transient Node Agent failure is re-queued with backoff
 * by `failJob`; the Deployment itself is only marked failed once the Build
 * really failed, so a restart never fails a Deployment by accident.
 */
async function runJob(job: JobRow): Promise<void> {
  const deploymentId = job.payload.deploymentId;
  if (!deploymentId) {
    await failJob(job.id, "Build Job is missing its deploymentId.");
    return;
  }

  const current = await pool.query<{ status: string }>(
    'SELECT "status" FROM "deployment" WHERE "id" = $1',
    [deploymentId],
  );
  if (!current.rowCount) {
    await completeJob(job.id);
    return;
  }
  if (current.rows[0].status === "cancelled") {
    await completeJob(job.id);
    return;
  }

  try {
    const result = await runBuildJob(job);

    // A Build that failed is a terminal outcome for this Job; retrying it would
    // rebuild the same broken commit forever.
    if (result.status === "failed") {
      await completeJob(job.id, "failed");
      console.log(`[worker] deployment ${deploymentId} build failed - ${result.message}`);
      return;
    }

    // A cancelled Deployment already has its Job cancelled by the API, so the
    // worker only has to leave the row alone.
    if (result.status === "cancelled") {
      console.log(`[worker] deployment ${deploymentId} build cancelled`);
      return;
    }

    // The Build produced an image. Run it as the Service container; the
    // Deployment only becomes `running` once the container answers its health
    // check, so a broken release never replaces a working one.
    const deployed = await runDeployment(deploymentId);
    await completeJob(job.id, deployed.status === "failed" ? "failed" : "succeeded");

    console.log(
      `[worker] deployment ${deploymentId} ${deployed.status}`,
      deployed.message ? `- ${deployed.message}` : "",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failJob(job.id, message);
    console.error(`[worker] deployment ${deploymentId} job failed: ${message}`);
  }
}

async function loop(): Promise<void> {
  let lastLogPrune = 0;
  let lastUsageRefresh = 0;

  while (!stopping) {
    if (Date.now() - lastUsageRefresh >= USAGE_REFRESH_INTERVAL_MS) {
      lastUsageRefresh = Date.now();
      try {
        const refreshed = await refreshAllOrganizationsUsage();
        if (refreshed.snapshots > 0) {
          console.log(
            `[worker] stored ${refreshed.snapshots} usage snapshots for ${refreshed.organizations} Organizations`,
          );
        }
      } catch (error) {
        console.error("[worker] could not refresh usage snapshots", error);
      }
    }

    // The retention pass is time based, so it runs before claiming work and then
    // at most once an hour. Doing it here keeps the worker a single process with
    // one responsibility: it owns everything that happens after a Deployment.
    if (Date.now() - lastLogPrune >= LOG_PRUNE_INTERVAL_MS) {
      lastLogPrune = Date.now();
      try {
        const pruned = await pruneLogs();
        if (pruned.lines > 0) {
          console.log(`[worker] pruned ${pruned.lines} Build log lines older than seven days`);
        }
      } catch (error) {
        console.error("[worker] could not prune old Build logs", error);
      }
    }

    let job: JobRow | null = null;

    try {
      job = await claimBuildJob();
    } catch (error) {
      console.error("[worker] could not claim a job", error);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!job) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    await runJob(job);
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
createAgentClient(
  process.env.AGENT_BASE_URL.replace(/\/+$/, ""),
  process.env.AGENT_TOKEN,
);

console.log("[worker] deployment worker started");
await loop();
