import { Pool } from "pg";
import { ApiError } from "./api-error.ts";
import { recordAudit } from "./audit.ts";
import { readStoredObject, type BackupStorageProvider } from "./backup-storage.ts";
import { backupTargetName } from "./backups.ts";
import { nodeConfig } from "./nodes.ts";
import { startService, stopService } from "./runtime.ts";

/**
 * Restore orchestration. A Restore puts a Database or Volume back to a Backup by
 * stopping the Services that use it, handing the artifact to the Node Agent, and
 * starting the Services again. The agent does the data work in a way that never
 * destroys the existing data before the new data is in place, so a failed
 * Restore leaves the target as it was.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const RESTORE_JOB_TYPE = "restore";

export type RestoreTargetType = "database" | "volume";
export type RestoreStatus = "pending" | "running" | "completed" | "failed";

export type RestoreSummary = {
  id: string;
  backupId: string | null;
  targetType: RestoreTargetType;
  targetName: string;
  projectName: string | null;
  status: RestoreStatus;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type RestoreList = { restores: RestoreSummary[] };

type RestoreRow = {
  id: string;
  organizationId: string;
  projectId: string | null;
  backupId: string | null;
  targetType: RestoreTargetType;
  targetId: string;
  status: RestoreStatus;
  errorMessage: string | null;
  createdBy: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

type RestorableBackup = {
  id: string;
  organizationId: string | null;
  projectId: string | null;
  targetType: "database" | "volume" | "platform";
  targetId: string | null;
  status: string;
  storageKey: string | null;
  storageProvider: BackupStorageProvider | null;
  projectName: string | null;
  serviceName: string | null;
};

const RESTORE_SUMMARY_COLUMNS = `
  r."id", r."backupId", r."targetType", r."targetId", r."status",
  r."errorMessage", r."createdAt", r."startedAt", r."finishedAt",
  p."name" AS "projectName", s."name" AS "serviceName"`;

const RESTORE_SUMMARY_JOINS = `
  LEFT JOIN "project" p ON p."id" = r."projectId"
  LEFT JOIN "volume" v
    ON r."targetType" = 'volume' AND v."dockerVolumeName" = r."targetId"
  LEFT JOIN "service" s ON s."id" = v."serviceId"`;

type RestoreListRow = Pick<
  RestoreRow,
  | "id"
  | "backupId"
  | "targetType"
  | "targetId"
  | "status"
  | "errorMessage"
  | "createdAt"
  | "startedAt"
  | "finishedAt"
> & { projectName: string | null; serviceName: string | null };

function toSummary(row: RestoreListRow): RestoreSummary {
  return {
    id: row.id,
    backupId: row.backupId,
    targetType: row.targetType,
    targetName: backupTargetName(row),
    projectName: row.projectName,
    status: row.status,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

async function loadRestorableBackup(
  organizationId: string,
  backupId: string,
): Promise<RestorableBackup | null> {
  const result = await pool.query<RestorableBackup>(
    `SELECT b."id", b."organizationId", b."projectId", b."targetType",
            b."targetId", b."status", b."storageKey", b."storageProvider",
            p."name" AS "projectName", s."name" AS "serviceName"
     FROM "backup" b
     LEFT JOIN "project" p ON p."id" = b."projectId"
     LEFT JOIN "volume" v
       ON b."targetType" = 'volume' AND v."dockerVolumeName" = b."targetId"
     LEFT JOIN "service" s ON s."id" = v."serviceId"
     WHERE b."id" = $1 AND b."organizationId" = $2`,
    [backupId, organizationId],
  );

  return result.rows[0] ?? null;
}

/**
 * Queues a Restore of one completed Database or Volume Backup. The typed
 * confirmation must match the target name the dashboard shows, so a click alone
 * can never start a Restore.
 */
export async function createRestore(input: {
  organizationId: string;
  actorUserId: string;
  backupId: string;
  confirmation: string;
}): Promise<RestoreSummary> {
  const backup = await loadRestorableBackup(input.organizationId, input.backupId);
  if (!backup) {
    throw new ApiError(404, "backup_not_found", "Backup not found.");
  }
  if (backup.targetType === "platform") {
    throw new ApiError(
      400,
      "backup_not_restorable",
      "Only Database and Volume Backups can be restored.",
    );
  }
  if (backup.status !== "completed") {
    throw new ApiError(
      409,
      "backup_not_completed",
      "Only a completed Backup can be restored.",
    );
  }
  if (!backup.storageKey || !backup.storageProvider || !backup.targetId) {
    throw new ApiError(
      409,
      "backup_unavailable",
      "The stored Backup artifact is no longer available.",
    );
  }

  const expected = backupTargetName(backup);
  if (input.confirmation.trim() !== expected) {
    throw new ApiError(
      400,
      "confirmation_mismatch",
      `Type "${expected}" to confirm the Restore.`,
      { expected },
    );
  }

  const restoreId = await queueRestore(input.organizationId, input.actorUserId, backup);

  await recordAudit(
    "backup.restore_requested",
    input.organizationId,
    input.actorUserId,
    undefined,
    {
      restoreId,
      backupId: backup.id,
      targetType: backup.targetType,
      targetId: backup.targetId,
      targetName: expected,
    },
  );

  return {
    id: restoreId,
    backupId: backup.id,
    targetType: backup.targetType,
    targetName: expected,
    projectName: backup.projectName,
    status: "pending",
    errorMessage: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  };
}

/**
 * Inserts the Restore and its Job in one transaction. The active-target index is
 * the real guard against two concurrent requests; the lookup before the insert
 * only turns the common case into a clear message.
 */
async function queueRestore(
  organizationId: string,
  actorUserId: string,
  backup: RestorableBackup,
): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const active = await client.query(
      `SELECT 1 FROM "restore"
       WHERE "organizationId" = $1 AND "targetType" = $2 AND "targetId" = $3
         AND "status" IN ('pending', 'running')
       LIMIT 1`,
      [organizationId, backup.targetType, backup.targetId],
    );
    if (active.rowCount !== 0) {
      throw new ApiError(
        409,
        "restore_in_progress",
        "A Restore of this target is already in progress.",
      );
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO "restore" ("id", "organizationId", "projectId", "backupId",
         "targetType", "targetId", "createdBy")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6)
       RETURNING "id"`,
      [
        organizationId,
        backup.projectId,
        backup.id,
        backup.targetType,
        backup.targetId,
        actorUserId,
      ],
    );
    const restoreId = inserted.rows[0].id;

    await client.query(
      `INSERT INTO "job" ("id", "type", "payload")
       VALUES (gen_random_uuid()::text, $1, $2::jsonb)`,
      [RESTORE_JOB_TYPE, JSON.stringify({ restoreId })],
    );

    await client.query("COMMIT");

    return restoreId;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);

    if ((error as { code?: string }).code === "23505") {
      throw new ApiError(
        409,
        "restore_in_progress",
        "A Restore of this target is already in progress.",
      );
    }

    throw error;
  } finally {
    client.release();
  }
}

type AffectedService = { id: string; name: string; status: string };

/**
 * The Services that must be stopped for a Restore: every Service in the Project
 * for a Database, and the owning Service for a Volume.
 */
async function loadAffectedServices(row: RestoreRow): Promise<AffectedService[]> {
  if (row.targetType === "database") {
    const result = await pool.query<AffectedService>(
      `SELECT "id", "name", "status" FROM "service"
       WHERE "projectId" = $1 ORDER BY "createdAt"`,
      [row.projectId],
    );

    return result.rows;
  }

  const result = await pool.query<AffectedService>(
    `SELECT s."id", s."name", s."status"
     FROM "volume" v JOIN "service" s ON s."id" = v."serviceId"
     WHERE v."dockerVolumeName" = $1`,
    [row.targetId],
  );

  return result.rows;
}

/**
 * Stops a Service for the Restore. A Service whose row says running but whose
 * container is already gone is not an error: there is nothing left to stop.
 */
async function stopForRestore(organizationId: string, service: AffectedService): Promise<void> {
  try {
    await stopService(organizationId, service.id);
  } catch (error) {
    if (error instanceof ApiError && error.code === "service_not_running") {
      return;
    }

    throw error;
  }
}

async function startAfterRestore(
  organizationId: string,
  service: AffectedService,
): Promise<string | null> {
  try {
    await startService(organizationId, service.id);

    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function sendRestoreToAgent(
  row: RestoreRow,
  bytes: Buffer,
): Promise<void> {
  const { baseUrl, token } = nodeConfig();
  const query = new URLSearchParams({
    targetType: row.targetType,
    targetId: row.targetId,
  });
  const url =
    `${baseUrl.replace(/\/+$/, "")}/v1/restores/${encodeURIComponent(row.id)}?${query}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
    },
    // Copy into a plain Uint8Array so fetch accepts the bytes as a body.
    body: new Uint8Array(bytes),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `the Node Agent answered ${response.status} for the Restore${detail ? `: ${detail}` : ""}`,
    );
  }
}

async function loadRestore(restoreId: string): Promise<RestoreRow | null> {
  const result = await pool.query<RestoreRow>(
    `SELECT "id", "organizationId", "projectId", "backupId", "targetType",
            "targetId", "status", "errorMessage", "createdBy",
            "createdAt", "startedAt", "finishedAt"
     FROM "restore" WHERE "id" = $1`,
    [restoreId],
  );

  return result.rows[0] ?? null;
}

/**
 * Runs one queued Restore Job end to end. The Services that were running are
 * always started again, whether the data work succeeded or failed, so a failed
 * Restore does not leave the Project down.
 */
export async function runRestoreJob(job: {
  id: string;
  payload: { restoreId?: string };
}): Promise<{ status: "completed" | "failed" }> {
  const restoreId = job.payload.restoreId;
  if (!restoreId) {
    throw new Error("Restore Job is missing its restoreId.");
  }

  const row = await loadRestore(restoreId);
  // The target may have been deleted after the Job was queued; nothing to do.
  if (!row) {
    return { status: "completed" };
  }
  if (row.status === "completed") {
    return { status: "completed" };
  }

  const backup = row.backupId
    ? await pool.query<{
        storageKey: string | null;
        storageProvider: BackupStorageProvider | null;
      }>(
        `SELECT "storageKey", "storageProvider" FROM "backup" WHERE "id" = $1`,
        [row.backupId],
      )
    : null;
  const artifact = backup?.rows[0] ?? null;

  await pool.query(
    `UPDATE "restore"
     SET "status" = 'running', "errorMessage" = NULL,
         "startedAt" = COALESCE("startedAt", now())
     WHERE "id" = $1`,
    [restoreId],
  );

  const services = await loadAffectedServices(row);
  const wasRunning = services.filter((service) => service.status === "running");

  let failure: string | null = null;

  try {
    if (!artifact?.storageKey || !artifact.storageProvider) {
      throw new Error("the Backup artifact is no longer available");
    }

    for (const service of wasRunning) {
      await stopForRestore(row.organizationId, service);
    }

    const bytes = await readStoredObject(artifact.storageKey, artifact.storageProvider);
    await sendRestoreToAgent(row, bytes);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  const restartErrors: string[] = [];
  for (const service of wasRunning) {
    const error = await startAfterRestore(row.organizationId, service);
    if (error) {
      restartErrors.push(`${service.name}: ${error}`);
    }
  }

  const finishedAt = new Date();

  if (failure) {
    await pool.query(
      `UPDATE "restore"
       SET "status" = 'failed', "errorMessage" = $2, "finishedAt" = $3
       WHERE "id" = $1`,
      [restoreId, failure, finishedAt],
    );

    await recordAudit(
      "backup.restore_failed",
      row.organizationId,
      row.createdBy,
      undefined,
      {
        restoreId,
        backupId: row.backupId,
        targetType: row.targetType,
        targetId: row.targetId,
        error: failure,
        servicesRestarted: wasRunning.length - restartErrors.length,
        restartErrors,
      },
    ).catch((error) => {
      console.error("could not record the failed Restore", error);
    });

    return { status: "failed" };
  }

  await pool.query(
    `UPDATE "restore"
     SET "status" = 'completed', "errorMessage" = NULL, "finishedAt" = $2
     WHERE "id" = $1`,
    [restoreId, finishedAt],
  );

  await recordAudit("backup.restored", row.organizationId, row.createdBy, undefined, {
    restoreId,
    backupId: row.backupId,
    targetType: row.targetType,
    targetId: row.targetId,
    servicesRestarted: wasRunning.length - restartErrors.length,
    restartErrors,
  }).catch((error) => {
    console.error("could not record the completed Restore", error);
  });

  return { status: "completed" };
}

/**
 * Fails Restores a previous worker left pending or running. There is exactly one
 * worker, so anything in flight when it starts is orphaned; leaving it would
 * block every later Restore of that target through the active-target index.
 */
export async function recoverStaleRestores(): Promise<{ failed: number }> {
  const result = await pool.query(
    `UPDATE "restore"
     SET "status" = 'failed',
         "errorMessage" = 'The worker restarted before the Restore finished.',
         "finishedAt" = now()
     WHERE "status" IN ('pending', 'running')`,
  );

  return { failed: result.rowCount ?? 0 };
}

/** Recent Restores for the Organization, newest first. */
export async function listRestores(organizationId: string): Promise<RestoreList> {
  const result = await pool.query<RestoreListRow>(
    `SELECT ${RESTORE_SUMMARY_COLUMNS}
     FROM "restore" r
     ${RESTORE_SUMMARY_JOINS}
     WHERE r."organizationId" = $1
     ORDER BY r."createdAt" DESC
     LIMIT 20`,
    [organizationId],
  );

  return { restores: result.rows.map(toSummary) };
}
