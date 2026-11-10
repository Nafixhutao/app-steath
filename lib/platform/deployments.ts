import { Pool } from "pg";
import {
  createAgentClient,
  streamBuildLogs,
  type AgentBuild,
  type AgentClient,
  type AgentDeploymentAbort,
} from "../../lib/agent-client.ts";
import { ApiError } from "./api-error.ts";
import { loadDeploymentDatabaseUrl } from "./databases.ts";
import { loadDeploymentEnvironment } from "./environment-variables.ts";
import { nodeConfig, requireHealthyNode } from "./nodes.ts";
import { QUOTAS } from "./quota-limits.ts";
import { enqueueScanJob } from "./scans.ts";
import { loadDeploymentVolume } from "./volumes.ts";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const BUILD_JOB_TYPE = "build";
export const MAX_BUILD_ATTEMPTS = 3;

/**
 * How long Build and runtime logs are kept. The spec fixes this at seven days:
 * long enough to investigate a fresh problem, short enough that the disk does
 * not fill up.
 */
export const LOG_RETENTION_DAYS = QUOTAS.logRetentionDays;

export type DeploymentStatus =
  "queued" | "building" | "deploying" | "running" | "failed" | "cancelled";

export type DeploymentSummary = {
  id: string;
  serviceId: string;
  status: DeploymentStatus;
  commitSha: string | null;
  imageRef: string | null;
  errorMessage: string | null;
  createdBy: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

type DeploymentRow = {
  id: string;
  serviceId: string;
  status: DeploymentStatus;
  commitSha: string | null;
  imageRef: string | null;
  errorMessage: string | null;
  createdBy: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

const DEPLOYMENT_FIELDS = [
  "id",
  "serviceId",
  "status",
  "commitSha",
  "imageRef",
  "errorMessage",
  "createdBy",
  "startedAt",
  "finishedAt",
  "createdAt",
] as const;

const DEPLOYMENT_COLUMNS = DEPLOYMENT_FIELDS.map((field) => `"${field}"`).join(", ");
const PREFIXED_DEPLOYMENT_COLUMNS = DEPLOYMENT_FIELDS.map((field) => `d."${field}"`).join(", ");

export type JobRow = {
  id: string;
  type: string;
  payload: {
    deploymentId?: string;
    serviceId?: string;
    backupId?: string;
    restoreId?: string;
  };
  attempts: number;
};

/** Statuses that keep a Service busy and block a second Deployment. */
export const ACTIVE_DEPLOYMENT_STATUSES: DeploymentStatus[] = ["queued", "building", "deploying"];

/**
 * Confirms the Service is visible to the Organization before listing anything.
 * Without this check a foreign Service id would answer 200 with an empty list,
 * which leaks that the id is not in the caller's tenant by omission instead of
 * by the 404 the spec requires.
 */
async function requireService(organizationId: string, serviceId: string): Promise<void> {
  const result = await pool.query(
    `SELECT 1 FROM "service" s JOIN "project" p ON p."id" = s."projectId"
     WHERE p."organizationId" = $1 AND s."id" = $2`,
    [organizationId, serviceId],
  );

  if (!result.rowCount) {
    throw new ApiError(404, "service_not_found", "Service not found.");
  }
}

export async function listDeployments(
  organizationId: string,
  serviceId: string,
): Promise<DeploymentSummary[]> {
  await requireService(organizationId, serviceId);

  const result = await pool.query<DeploymentRow>(
    `SELECT ${PREFIXED_DEPLOYMENT_COLUMNS}
     FROM "deployment" d
     JOIN "service" s ON s."id" = d."serviceId"
     JOIN "project" p ON p."id" = s."projectId"
     WHERE p."organizationId" = $1 AND d."serviceId" = $2
     ORDER BY d."createdAt" DESC`,
    [organizationId, serviceId],
  );

  return result.rows;
}

export async function getDeployment(
  organizationId: string,
  deploymentId: string,
): Promise<DeploymentSummary> {
  const result = await pool.query<DeploymentRow>(
    `SELECT ${PREFIXED_DEPLOYMENT_COLUMNS}
     FROM "deployment" d
     JOIN "service" s ON s."id" = d."serviceId"
     JOIN "project" p ON p."id" = s."projectId"
     WHERE p."organizationId" = $1 AND d."id" = $2`,
    [organizationId, deploymentId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "deployment_not_found", "Deployment not found.");
  }

  return row;
}

/**
 * Creates a Deployment in `queued` and a Build Job in one transaction, so a
 * Deployment can never exist without the Job that will process it. The Service
 * row is locked to make the "one active Deployment" rule hold under concurrency.
 *
 * `commitSha` pins the Build to an exact commit, which is what a redeploy uses so
 * it rebuilds the same code as the Deployment it replaces. An empty value means
 * "the tip of the branch".
 */
export async function triggerDeployment(input: {
  organizationId: string;
  serviceId: string;
  userId: string;
  commitSha?: string | null;
}): Promise<{ deployment: DeploymentSummary; service: { id: string; name: string } }> {
  // Block new Deployments while no Node Agent is heartbeating, so the Job never
  // sits queued with no worker able to build it.
  await requireHealthyNode();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const service = await client.query<{
      id: string;
      name: string;
      status: string;
      repoUrl: string;
    }>(
      `SELECT s."id", s."name", s."status", s."repoUrl"
       FROM "service" s JOIN "project" p ON p."id" = s."projectId"
       WHERE p."organizationId" = $1 AND s."id" = $2
       FOR UPDATE OF s`,
      [input.organizationId, input.serviceId],
    );

    const current = service.rows[0];
    if (!current) {
      throw new ApiError(404, "service_not_found", "Service not found.");
    }
    if (current.status === "suspended") {
      throw new ApiError(
        409,
        "service_suspended",
        "This Service is suspended and cannot be deployed.",
      );
    }

    const active = await client.query<{ id: string }>(
      `SELECT "id" FROM "deployment"
       WHERE "serviceId" = $1 AND "status" = ANY($2::text[])
       LIMIT 1`,
      [input.serviceId, ACTIVE_DEPLOYMENT_STATUSES],
    );
    if (active.rowCount) {
      throw new ApiError(
        409,
        "deployment_in_progress",
        "This Service already has a Deployment in progress.",
      );
    }

    // A redeploy records the pinned commit immediately, so the history shows the
    // commit being rebuilt while the Build is still queued. The Build then
    // replaces it with the resolved full SHA once it has checked it out.
    const pinnedCommit = input.commitSha?.trim() ? input.commitSha.trim() : null;

    const deployment = await client.query<DeploymentRow>(
      `INSERT INTO "deployment" ("id", "serviceId", "status", "commitSha", "createdBy")
       VALUES (gen_random_uuid()::text, $1, 'queued', $2, $3)
       RETURNING ${DEPLOYMENT_COLUMNS}`,
      [input.serviceId, pinnedCommit, input.userId],
    );

    await client.query(
      `INSERT INTO "job" ("id", "type", "payload", "status")
       VALUES (gen_random_uuid()::text, $1, $2::jsonb, 'queued')`,
      [
        BUILD_JOB_TYPE,
        JSON.stringify({ deploymentId: deployment.rows[0].id, serviceId: input.serviceId }),
      ],
    );

    await client.query('UPDATE "service" SET "status" = \'deploying\' WHERE "id" = $1', [
      input.serviceId,
    ]);

    await client.query("COMMIT");

    return {
      deployment: deployment.rows[0],
      service: { id: current.id, name: current.name },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Claims the next queued Job of one of the given types. `FOR UPDATE SKIP
 * LOCKED` plus the single-worker design gives the spec's Build concurrency of
 * one per node: the second worker finds nothing claimable instead of waiting on
 * a row lock. Backup Jobs share the same queue, so the worker asks for both.
 */
export async function claimBuildJob(types: string[] = [BUILD_JOB_TYPE]): Promise<JobRow | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const job = await client.query<JobRow>(
      `SELECT "id", "type", "payload", "attempts" FROM "job"
       WHERE "status" = 'queued' AND "type" = ANY($1::text[]) AND "runAt" <= now()
       ORDER BY "createdAt"
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [types],
    );

    const row = job.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null;
    }

    await client.query(
      `UPDATE "job" SET "status" = 'running', "lockedAt" = now(), "attempts" = "attempts" + 1
       WHERE "id" = $1`,
      [row.id],
    );

    await client.query("COMMIT");
    return { ...row, attempts: row.attempts + 1 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Marks a Job finished. `succeeded` means the work completed; `failed` is a
 * terminal failure that must not be retried. Transient errors use `failJob`,
 * which re-queues the Job with backoff instead.
 */
export async function completeJob(
  jobId: string,
  outcome: "succeeded" | "failed" = "succeeded",
): Promise<void> {
  await pool.query('UPDATE "job" SET "status" = $2, "lockedAt" = NULL WHERE "id" = $1', [
    jobId,
    outcome,
  ]);
}

/**
 * Re-queues a Job that failed for a transient reason, or marks it failed once it
 * ran out of attempts. A `runAt` in the future backs the retry off.
 */
export async function failJob(jobId: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE "job"
     SET "status" = CASE WHEN "attempts" >= $2 THEN 'failed' ELSE 'queued' END,
         "lastError" = $3,
         "runAt" = now() + make_interval(secs => "attempts" * 5),
         "lockedAt" = NULL
     WHERE "id" = $1`,
    [jobId, MAX_BUILD_ATTEMPTS, error],
  );
}

/** Marks the Deployment `building` and records when the attempt started. */
export async function markDeploymentBuilding(deploymentId: string): Promise<void> {
  await pool.query(
    `UPDATE "deployment" SET "status" = 'building', "startedAt" = COALESCE("startedAt", now())
     WHERE "id" = $1 AND "status" = 'queued'`,
    [deploymentId],
  );
}

/**
 * Marks the Deployment `failed` and stores the reason shown in the dashboard.
 * A failed Build must leave the previously running version untouched, so the
 * Service status is re-derived instead of being forced to `failed`: it returns
 * to `running` when an older Deployment is still serving, and to `not_deployed`
 * when this was the first attempt.
 */
export async function markDeploymentFailed(deploymentId: string, message: string): Promise<void> {
  await pool.query(
    `UPDATE "deployment"
     SET "status" = 'failed', "errorMessage" = $2, "finishedAt" = now()
     WHERE "id" = $1 AND "status" IN ('queued', 'building', 'deploying')`,
    [deploymentId, message],
  );

  await pool.query(
    `UPDATE "service" s
     SET "status" = CASE
       WHEN EXISTS (
         SELECT 1 FROM "deployment" d
         WHERE d."serviceId" = s."id" AND d."status" = 'running'
       ) THEN 'running'
       ELSE 'not_deployed'
     END
     WHERE s."id" = (SELECT "serviceId" FROM "deployment" WHERE "id" = $1)
       AND s."status" = 'deploying'`,
    [deploymentId],
  );
}

/**
 * Marks a Deployment failed after its Build did not succeed, so the Job outcome
 * and the Deployment state never disagree.
 */
export async function failDeployment(
  jobId: string,
  deploymentId: string,
  message: string,
): Promise<void> {
  await markDeploymentFailed(deploymentId, message);
  await completeJob(jobId, "failed");
}

/**
 * Records a successful Build: the image reference and commit are stored and the
 * Deployment moves to `deploying`, where ticket 07 picks it up to run the
 * container. The previous running Deployment is left untouched on purpose.
 */
export async function markDeploymentBuilt(input: {
  deploymentId: string;
  imageRef: string;
  commitSha: string;
}): Promise<void> {
  await pool.query(
    `UPDATE "deployment"
     SET "status" = 'deploying', "imageRef" = $2, "commitSha" = $3
     WHERE "id" = $1 AND "status" = 'building'`,
    [input.deploymentId, input.imageRef, input.commitSha],
  );
}

/**
 * Runs the runtime half of a Deployment: asks the Node Agent to start the built
 * image, and marks the Deployment `running` only once the container is healthy and
 * serving. A Deployment whose container never becomes healthy is marked `failed`
 * while the previous version keeps serving.
 */
export async function runDeployment(
  deploymentId: string,
  options: { client?: AgentClient } = {},
): Promise<{ status: "running" | "failed" | "cancelled"; message: string }> {
  const details = await pool.query<{
    deploymentId: string;
    serviceId: string;
    status: DeploymentStatus;
    serviceStatus: string;
    imageRef: string | null;
    projectId: string;
    organizationId: string;
    platformHostname: string;
    containerPort: number;
    healthPath: string | null;
    cpuLimit: string | number;
    memoryLimitMb: number;
  }>(
    `SELECT d."id" AS "deploymentId", d."serviceId", d."status", s."status" AS "serviceStatus", d."imageRef",
            s."projectId", p."organizationId", s."platformHostname",
            s."containerPort", s."healthPath", s."cpuLimit", s."memoryLimitMb"
     FROM "deployment" d
     JOIN "service" s ON s."id" = d."serviceId"
     JOIN "project" p ON p."id" = s."projectId"
     WHERE d."id" = $1`,
    [deploymentId],
  );

  const deployment = details.rows[0];
  if (!deployment) {
    throw new Error(`Deployment ${deploymentId} no longer exists.`);
  }
  if (deployment.serviceStatus === "suspended") {
    const message = "The Service is suspended by the Platform Admin.";
    // Leave the Deployment in a terminal state so the worker's Job outcome and
    // the row never disagree. markDeploymentFailed only re-derives a Service
    // that is `deploying`, so it cannot overwrite the suspended status.
    await markDeploymentFailed(deploymentId, message);
    return { status: "failed", message };
  }
  // A cancel that landed between the Build finishing and this call must not
  // start a container for a Deployment the user already abandoned.
  if (deployment.status === "cancelled") {
    return { status: "cancelled", message: "" };
  }
  if (!deployment.imageRef) {
    const message = "The Deployment has no image to run.";
    await markDeploymentFailed(deploymentId, message);
    return { status: "failed", message };
  }

  // The revision and its values are one consistent snapshot: the container is
  // started with exactly the values this revision held, so a Service whose
  // revision is newer afterwards is honestly reported as needing a redeploy.
  let environment: Array<{ name: string; value: string }>;
  let envRevision: number;
  let volume: { name: string; mountPath: string; sizeMb: number } | null;
  try {
    const snapshot = await loadDeploymentEnvironment(deployment.serviceId);
    envRevision = snapshot.revision;
    environment = snapshot.environment;
    volume = await loadDeploymentVolume(deployment.serviceId);

    // `DATABASE_URL` is platform-owned: a user value is reserved, and the real
    // value is built from the Project Database at deploy time so a rotated
    // password is never stale in a running container.
    const databaseUrl = await loadDeploymentDatabaseUrl(deployment.projectId);
    if (databaseUrl) {
      environment = environment.filter((variable) => variable.name !== "DATABASE_URL");
      environment.push({ name: "DATABASE_URL", value: databaseUrl });
    }
  } catch (error) {
    const message =
      error instanceof ApiError
        ? error.message
        : "The Service's Environment Variables or Volume could not be read.";
    await markDeploymentFailed(deploymentId, message);
    return { status: "failed", message };
  }

  // The values travel to the Node Agent in this request body only. They are
  // never logged here: a failure is reported with a reason, not a payload.
  await pool.query('UPDATE "deployment" SET "envRevision" = $2 WHERE "id" = $1', [
    deploymentId,
    envRevision,
  ]);

  const client = options.client ?? createAgentClient(nodeConfig().baseUrl, nodeConfig().token);

  const started = await client.POST("/v1/deployments", {
    body: {
      deploymentId: deployment.deploymentId,
      serviceId: deployment.serviceId,
      projectId: deployment.projectId,
      organizationId: deployment.organizationId,
      hostname: deployment.platformHostname,
      imageRef: deployment.imageRef,
      containerPort: deployment.containerPort,
      cpuLimit: Number(deployment.cpuLimit),
      memoryLimitMb: deployment.memoryLimitMb,
      ...(environment.length > 0 ? { environmentVariables: environment } : {}),
      ...(volume ? { volume } : {}),
      ...(deployment.healthPath ? { healthPath: deployment.healthPath } : {}),
    },
  });

  if (!started.response.ok || !started.data) {
    const message = `The Node Agent rejected the Deployment (${started.response.status}).`;
    await markDeploymentFailed(deploymentId, message);
    return { status: "failed", message };
  }

  if (started.data.status !== "running") {
    const message = started.data.error ?? "The container did not become healthy.";
    await markDeploymentFailed(deploymentId, message);
    return { status: "failed", message };
  }

  await markDeploymentRunning(deploymentId);

  return { status: "running", message: "" };
}

/**
 * Marks the Deployment `running` and points the Service at it. Only the newest
 * successful Deployment keeps the Service `running`; older ones stay `running`
 * in the history because they did serve traffic at the time.
 */
export async function markDeploymentRunning(deploymentId: string): Promise<void> {
  await pool.query(
    `UPDATE "deployment"
     SET "status" = 'running', "finishedAt" = now()
     WHERE "id" = $1 AND "status" = 'deploying'`,
    [deploymentId],
  );

  await pool.query(
    `UPDATE "service" s
     SET "status" = 'running', "updatedAt" = now()
     WHERE s."id" = (SELECT "serviceId" FROM "deployment" WHERE "id" = $1)
       AND s."status" <> 'suspended'`,
    [deploymentId],
  );
}

/**
 * Marks the Service `stopped` without touching its Deployment history, which is
 * what the runtime does when the user stops a Service.
 */
export async function markServiceStopped(serviceId: string): Promise<void> {
  await pool.query(
    `UPDATE "service" SET "status" = 'stopped', "updatedAt" = now() WHERE "id" = $1 AND "status" <> 'suspended'`,
    [serviceId],
  );
}

/**
 * Marks the Service `running` again after a start or restart.
 */
export async function markServiceRunning(serviceId: string): Promise<void> {
  await pool.query(
    `UPDATE "service" SET "status" = 'running', "updatedAt" = now() WHERE "id" = $1 AND "status" <> 'suspended'`,
    [serviceId],
  );
}

/**
 * Appends Build log lines. The sequence continues from the highest stored value
 * so a resumed stream never collides with an earlier line.
 */
export async function appendBuildLog(deploymentId: string, messages: string[]): Promise<void> {
  if (messages.length === 0) return;

  await pool.query(
    `INSERT INTO "build_log" ("deploymentId", "sequence", "message")
     SELECT $1, start."sequence" + row_number() OVER (ORDER BY line."ordinality"), line."message"
     FROM (SELECT COALESCE(max("sequence"), 0) AS "sequence" FROM "build_log" WHERE "deploymentId" = $1) AS start,
          unnest($2::text[]) WITH ORDINALITY AS line("message", "ordinality")`,
    [deploymentId, messages],
  );
}

export async function listBuildLog(deploymentId: string): Promise<string[]> {
  const result = await pool.query<{ message: string }>(
    'SELECT "message" FROM "build_log" WHERE "deploymentId" = $1 ORDER BY "sequence"',
    [deploymentId],
  );

  return result.rows.map((row) => row.message);
}

/**
 * Runs one claimed Build Job end to end: tells the Node Agent to build, streams
 * the log into the database, and moves the Deployment to `deploying` or
 * `failed`. It returns the final Deployment status for the caller to log.
 */
export async function runBuildJob(job: JobRow, options: { client?: AgentClient } = {}) {
  const deploymentId = job.payload.deploymentId;
  if (!deploymentId) {
    throw new Error("Build Job is missing its deploymentId.");
  }

  const details = await pool.query<{
    id: string;
    repoUrl: string;
    branch: string;
    dockerfilePath: string;
    serviceId: string;
    commitSha: string | null;
  }>(
    `SELECT d."id", d."serviceId", d."commitSha", s."repoUrl", s."branch", s."dockerfilePath"
     FROM "deployment" d JOIN "service" s ON s."id" = d."serviceId"
     WHERE d."id" = $1`,
    [deploymentId],
  );

  const deployment = details.rows[0];
  if (!deployment) {
    throw new Error(`Deployment ${deploymentId} no longer exists.`);
  }

  await markDeploymentBuilding(deploymentId);

  const client = options.client ?? createAgentClient(nodeConfig().baseUrl, nodeConfig().token);
  const imageTag = buildImageTag(deployment.serviceId, deploymentId);

  const started = await client.POST("/v1/builds", {
    body: {
      buildId: deploymentId,
      repoUrl: deployment.repoUrl,
      branch: deployment.branch,
      dockerfilePath: deployment.dockerfilePath,
      imageTag,
      // A redeploy pins the commit so the rebuild uses the same code even when
      // the branch has moved on.
      ...(deployment.commitSha ? { commitSha: deployment.commitSha } : {}),
    },
  });

  if (!started.response.ok || !started.data) {
    const message = `The Node Agent rejected the Build (${started.response.status}).`;
    await markDeploymentFailed(deploymentId, message);
    return { status: "failed" as const, message };
  }

  // The log stream ends when the Build finishes, so streaming is also the
  // completion signal. Lines are flushed in batches to avoid one write per line.
  const pending: string[] = [];
  await streamBuildLogs(client, deploymentId, 0, async (event) => {
    pending.push(event.message);
    if (pending.length >= 25) {
      await appendBuildLog(deploymentId, pending.splice(0, pending.length));
    }
  });
  await appendBuildLog(deploymentId, pending.splice(0, pending.length));

  const finished = await client.GET("/v1/builds/{buildId}", {
    params: { path: { buildId: deploymentId } },
  });

  if (!finished.response.ok || !finished.data) {
    const message = `The Node Agent did not report a Build result (${finished.response.status}).`;
    await markDeploymentFailed(deploymentId, message);
    return { status: "failed" as const, message };
  }

  const build: AgentBuild = finished.data;

  // A Build that the user cancelled is not a failure: the Deployment row is
  // already `cancelled`, so it must not be rewritten with an error message.
  if (build.status === "cancelled") {
    await markDeploymentCancelled(deploymentId);
    return { status: "cancelled" as const, message: "" };
  }

  if (build.status !== "succeeded" || !build.imageRef) {
    const message = build.error ?? "The Build failed.";
    await markDeploymentFailed(deploymentId, message);
    return { status: "failed" as const, message };
  }

  await markDeploymentBuilt({
    deploymentId,
    imageRef: build.imageRef,
    // The Build reports the commit it actually checked out. Falling back to the
    // pinned commit keeps a redeploy's history accurate even if the agent omits
    // it.
    commitSha: build.commitSha || deployment.commitSha || "",
  });

  // Every successful Build is scanned, whether or not the later runtime
  // Deployment succeeds. Scanning is advisory and queued separately, so a
  // scanner outage never changes the Build result.
  await enqueueScanJob(deploymentId).catch((error) => {
    console.error(`could not queue the image scan for Deployment ${deploymentId}`, error);
  });

  return { status: "deploying" as const, message: "" };
}

/**
 * Deterministic image tag for a Deployment. It carries the Deployment id so the
 * runtime can find the exact image a Deployment produced.
 */
export function buildImageTag(serviceId: string, deploymentId: string): string {
  return `stealth/service-${serviceId}:${deploymentId}`;
}

/** Deployment statuses a cancel is allowed to touch. */
export const CANCELLABLE_DEPLOYMENT_STATUSES: DeploymentStatus[] = ["queued", "building"];

/**
 * Cancels a Deployment that is still queued or building. The Node Agent stops the
 * Build and removes any container and image the attempt produced; the route is
 * never touched, so a Service that is already serving keeps serving.
 *
 * The Control Plane marks the Deployment `cancelled` even when the Node Agent
 * cannot be reached, because the worker refuses to build a cancelled Deployment.
 * Leftover containers and images from that case are removed by the agent's
 * startup Cleanup, so a cancel never leaks resources permanently.
 */
export async function cancelDeployment(input: {
  organizationId: string;
  deploymentId: string;
  options?: { client?: AgentClient };
}): Promise<{ deployment: DeploymentSummary; aborted: AgentDeploymentAbort | null }> {
  const found = await pool.query<{
    id: string;
    serviceId: string;
    status: DeploymentStatus;
    imageRef: string | null;
  }>(
    `SELECT d."id", d."serviceId", d."status", d."imageRef"
     FROM "deployment" d
     JOIN "service" s ON s."id" = d."serviceId"
     JOIN "project" p ON p."id" = s."projectId"
     WHERE p."organizationId" = $1 AND d."id" = $2`,
    [input.organizationId, input.deploymentId],
  );

  const current = found.rows[0];
  if (!current) {
    throw new ApiError(404, "deployment_not_found", "Deployment not found.");
  }
  if (!CANCELLABLE_DEPLOYMENT_STATUSES.includes(current.status)) {
    throw new ApiError(
      409,
      "deployment_not_cancellable",
      "Only a Deployment that is still queued or building can be cancelled.",
    );
  }

  const client =
    input.options?.client ?? createAgentClient(nodeConfig().baseUrl, nodeConfig().token);

  // The image tag is deterministic, so the Control Plane can name the image even
  // when the Build was cancelled before it reported one. Without this the image a
  // cancelled Build already tagged would survive until the retention prune.
  const imageRef = current.imageRef ?? buildImageTag(current.serviceId, input.deploymentId);

  const abort = await client.POST("/v1/deployments/{deploymentId}/cancel", {
    params: { path: { deploymentId: input.deploymentId } },
    body: { serviceId: current.serviceId, imageRef },
  });

  // The agent answered with a real outcome, or it could not be reached. Either
  // way the Control Plane stops the Deployment: a cancelled row is what keeps the
  // worker from starting the Build.
  const aborted = abort.response.ok ? (abort.data ?? null) : null;
  if (!abort.response.ok) {
    console.error(
      `cancel ${input.deploymentId}: the Node Agent did not confirm (${abort.response.status})`,
    );
  }

  await markDeploymentCancelled(input.deploymentId);

  const deployment = await pool.query<DeploymentRow>(
    `SELECT ${DEPLOYMENT_COLUMNS} FROM "deployment" WHERE "id" = $1`,
    [input.deploymentId],
  );

  return { deployment: deployment.rows[0], aborted };
}

/**
 * Marks a Deployment `cancelled` and puts the Service back where it was before
 * the attempt: `running` when an older Deployment still serves traffic, and
 * `not_deployed` when this was the first try. A cancelled Build never leaves the
 * Service stuck in `deploying`.
 */
export async function markDeploymentCancelled(deploymentId: string): Promise<void> {
  await pool.query(
    `UPDATE "deployment"
     SET "status" = 'cancelled', "finishedAt" = now()
     WHERE "id" = $1 AND "status" IN ('queued', 'building', 'deploying')`,
    [deploymentId],
  );

  // The Job is cancelled too, so a queued Job is never claimed for work whose
  // Deployment is already gone.
  await pool.query(
    `UPDATE "job" SET "status" = 'cancelled', "lockedAt" = NULL
     WHERE "payload"->>'deploymentId' = $1 AND "status" IN ('queued', 'running')`,
    [deploymentId],
  );

  await pool.query(
    `UPDATE "service" s
     SET "status" = CASE
       WHEN EXISTS (
         SELECT 1 FROM "deployment" d
         WHERE d."serviceId" = s."id" AND d."status" = 'running'
       ) THEN 'running'
       ELSE 'not_deployed'
     END
     WHERE s."id" = (SELECT "serviceId" FROM "deployment" WHERE "id" = $1)
       AND s."status" = 'deploying'`,
    [deploymentId],
  );
}

/**
 * Triggers a Deployment that rebuilds the same commit as an existing one. The
 * commit is read from the stored Deployment instead of the request body, so a
 * redeploy can never be talked into building different code.
 */
export async function redeployDeployment(input: {
  organizationId: string;
  deploymentId: string;
  userId: string;
}): Promise<{ deployment: DeploymentSummary; service: { id: string; name: string } }> {
  const previous = await getDeployment(input.organizationId, input.deploymentId);

  return triggerDeployment({
    organizationId: input.organizationId,
    serviceId: previous.serviceId,
    userId: input.userId,
    commitSha: previous.commitSha,
  });
}

/**
 * Deletes Build log lines older than the retention window. Runtime logs are not
 * copied into the database: the Node Agent reads them straight from the container
 * and never returns a line older than the same window, so retention holds for both
 * kinds of log without a second store to prune.
 *
 * It returns how many lines it deleted so the caller can log a real number
 * instead of assuming the cleanup worked.
 */
export async function pruneLogs(): Promise<{ lines: number }> {
  const lines = await pool.query(
    `DELETE FROM "build_log" bl
     USING "deployment" d
     WHERE bl."deploymentId" = d."id"
       AND bl."createdAt" < now() - make_interval(days => $1)`,
    [LOG_RETENTION_DAYS],
  );

  return { lines: lines.rowCount ?? 0 };
}
