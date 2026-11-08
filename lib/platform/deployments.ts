import { Pool } from "pg";
import {
  createAgentClient,
  streamBuildLogs,
  type AgentBuild,
  type AgentClient,
} from "../../lib/agent-client.ts";
import { ApiError } from "./api-error.ts";
import { nodeConfig, requireHealthyNode } from "./nodes.ts";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const BUILD_JOB_TYPE = "build";
export const MAX_BUILD_ATTEMPTS = 3;

export type DeploymentStatus =
  | "queued"
  | "building"
  | "deploying"
  | "running"
  | "failed"
  | "cancelled";

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
  payload: { deploymentId?: string; serviceId?: string };
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
 */
export async function triggerDeployment(input: {
  organizationId: string;
  serviceId: string;
  userId: string;
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

    const deployment = await client.query<DeploymentRow>(
      `INSERT INTO "deployment" ("id", "serviceId", "status", "createdBy")
       VALUES (gen_random_uuid()::text, $1, 'queued', $2)
       RETURNING ${DEPLOYMENT_COLUMNS}`,
      [input.serviceId, input.userId],
    );

    await client.query(
      `INSERT INTO "job" ("id", "type", "payload", "status")
       VALUES (gen_random_uuid()::text, $1, $2::jsonb, 'queued')`,
      [
        BUILD_JOB_TYPE,
        JSON.stringify({ deploymentId: deployment.rows[0].id, serviceId: input.serviceId }),
      ],
    );

    await client.query(
      'UPDATE "service" SET "status" = \'deploying\' WHERE "id" = $1',
      [input.serviceId],
    );

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
 * Claims the next Build Job. `FOR UPDATE SKIP LOCKED` plus the single-worker
 * design gives the spec's Build concurrency of one per node: the second worker
 * finds nothing claimable instead of waiting on a row lock.
 */
export async function claimBuildJob(): Promise<JobRow | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const job = await client.query<JobRow>(
      `SELECT "id", "type", "payload", "attempts" FROM "job"
       WHERE "status" = 'queued' AND "type" = $1 AND "runAt" <= now()
       ORDER BY "createdAt"
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [BUILD_JOB_TYPE],
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
export async function completeJob(jobId: string, outcome: "succeeded" | "failed" = "succeeded"): Promise<void> {
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
export async function failDeployment(jobId: string, deploymentId: string, message: string): Promise<void> {
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
  }>(
    `SELECT d."id", d."serviceId", s."repoUrl", s."branch", s."dockerfilePath"
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

  if (build.status !== "succeeded" || !build.imageRef) {
    const message = build.error ?? "The Build failed.";
    await markDeploymentFailed(deploymentId, message);
    return { status: "failed" as const, message };
  }

  await markDeploymentBuilt({
    deploymentId,
    imageRef: build.imageRef,
    commitSha: build.commitSha ?? "",
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
