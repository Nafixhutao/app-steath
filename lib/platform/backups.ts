import { Pool } from "pg";
import { createAgentClient } from "../../lib/agent-client.ts";
import { recordAudit } from "./audit.ts";
import {
  backupStorageConfigFromEnv,
  createBackupStorage,
  createLocalBackupStorage,
  hasS3Credentials,
  safeLocalPath,
  type BackupStorageProvider,
} from "./backup-storage.ts";
import { nodeConfig } from "./nodes.ts";

/**
 * Daily Backup orchestration. The worker schedules one Backup per Database, per
 * Volume, and one for the platform PostgreSQL at 02.00 UTC, then processes the
 * queued Jobs. The Node Agent produces the artifact; this module stores it in
 * S3-compatible storage when configured and on local disk otherwise, and removes
 * both object and metadata after seven days.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const BACKUP_JOB_TYPE = "backup";
export const BACKUP_RETENTION_DAYS = 7;
/** The spec fixes the daily run at 02.00 UTC. */
export const DAILY_BACKUP_UTC_HOUR = 2;

export type BackupTargetType = "database" | "volume" | "platform";
export type BackupStatus = "pending" | "running" | "completed" | "failed";

export type BackupSummary = {
  id: string;
  targetType: BackupTargetType;
  targetName: string;
  projectName: string | null;
  status: BackupStatus;
  storageProvider: BackupStorageProvider | null;
  sizeBytes: number;
  errorMessage: string | null;
  createdAt: string;
  expiresAt: string;
};

export type BackupList = {
  backups: BackupSummary[];
  /** What a new Backup would use right now, so the dashboard can warn. */
  storageProvider: BackupStorageProvider;
};

type BackupRow = {
  id: string;
  organizationId: string | null;
  projectId: string | null;
  targetType: BackupTargetType;
  targetId: string | null;
  status: BackupStatus;
  storageKey: string | null;
  storageProvider: BackupStorageProvider | null;
  sizeBytes: string | number;
  errorMessage: string | null;
  createdAt: Date;
  expiresAt: Date;
};

type BackupTarget = {
  targetType: BackupTargetType;
  targetId: string | null;
  organizationId: string | null;
  projectId: string | null;
};

/**
 * Creates today's Backups if they do not exist yet and queues one Job per
 * Backup. Running twice on the same day is a no-op, which is what makes a worker
 * restart safe.
 */
export async function scheduleDailyBackups(
  now: Date = new Date(),
): Promise<{ scheduled: number; skipped: boolean }> {
  if (now.getUTCHours() < DAILY_BACKUP_UTC_HOUR) {
    return { scheduled: 0, skipped: true };
  }

  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `backup-schedule:${startOfDay.toISOString()}`,
    ]);

    const targets = await client.query<BackupTarget>(
      `SELECT 'database' AS "targetType", d."id" AS "targetId",
              p."organizationId", p."id" AS "projectId"
       FROM "database" d
       JOIN "project" p ON p."id" = d."projectId"
       WHERE NOT EXISTS (
         SELECT 1 FROM "backup" b
         WHERE b."targetType" = 'database' AND b."targetId" = d."id"
           AND b."createdAt" >= $1
       )
       UNION ALL
       SELECT 'volume', v."dockerVolumeName", p."organizationId", p."id"
       FROM "volume" v
       JOIN "service" s ON s."id" = v."serviceId"
       JOIN "project" p ON p."id" = s."projectId"
       WHERE NOT EXISTS (
         SELECT 1 FROM "backup" b
         WHERE b."targetType" = 'volume' AND b."targetId" = v."dockerVolumeName"
           AND b."createdAt" >= $1
       )`,
      [startOfDay],
    );

    const hasPlatformBackup = await client.query(
      `SELECT 1 FROM "backup"
       WHERE "targetType" = 'platform' AND "createdAt" >= $1
       LIMIT 1`,
      [startOfDay],
    );

    const pending: BackupTarget[] = [...targets.rows];
    if (hasPlatformBackup.rowCount === 0) {
      pending.push({
        targetType: "platform",
        targetId: null,
        organizationId: null,
        projectId: null,
      });
    }

    for (const target of pending) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO "backup" ("id", "organizationId", "projectId", "targetType",
           "targetId", "expiresAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4,
           now() + make_interval(days => $5))
         RETURNING "id"`,
        [
          target.organizationId,
          target.projectId,
          target.targetType,
          target.targetId,
          BACKUP_RETENTION_DAYS,
        ],
      );

      await client.query(
        `INSERT INTO "job" ("id", "type", "payload")
         VALUES (gen_random_uuid()::text, $1, $2::jsonb)`,
        [BACKUP_JOB_TYPE, JSON.stringify({ backupId: inserted.rows[0].id })],
      );
    }

    await client.query("COMMIT");

    return { scheduled: pending.length, skipped: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function loadBackup(backupId: string): Promise<BackupRow | null> {
  const result = await pool.query<BackupRow>(
    `SELECT "id", "organizationId", "projectId", "targetType", "targetId",
            "status", "storageKey", "storageProvider", "sizeBytes", "errorMessage",
            "createdAt", "expiresAt"
     FROM "backup" WHERE "id" = $1`,
    [backupId],
  );

  return result.rows[0] ?? null;
}

type AgentBackupRequest = {
  backupId: string;
  targetType: BackupTargetType;
  targetId?: string;
  containerName?: string;
  databaseName?: string;
  username?: string;
};

function platformTarget(): Pick<
  AgentBackupRequest,
  "containerName" | "databaseName" | "username"
> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to Back up the platform PostgreSQL");
  }

  const url = new URL(connectionString);

  return {
    containerName: process.env.PLATFORM_DB_CONTAINER ?? "stealth-postgres",
    databaseName: decodeURIComponent(url.pathname.replace(/^\//, "")),
    username: decodeURIComponent(url.username),
  };
}

function agentRequestFor(row: BackupRow): AgentBackupRequest {
  if (row.targetType === "platform") {
    return {
      backupId: row.id,
      targetType: "platform",
      ...platformTarget(),
    };
  }

  return {
    backupId: row.id,
    targetType: row.targetType,
    targetId: row.targetId ?? undefined,
  };
}

export function backupStorageKey(row: Pick<BackupRow, "id" | "organizationId" | "targetType">): string {
  const extension = row.targetType === "volume" ? ".tar.gz" : ".dump";

  return `backups/${row.organizationId ?? "platform"}/${row.id}${extension}`;
}

async function downloadBackup(backupId: string): Promise<Buffer> {
  const { baseUrl, token } = nodeConfig();
  const response = await fetch(
    `${baseUrl.replace(/\/+$/, "")}/v1/backups/${encodeURIComponent(backupId)}/content`,
    { headers: { authorization: `Bearer ${token}` } },
  );

  if (!response.ok) {
    throw new Error(`the Node Agent answered ${response.status} for Backup ${backupId}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * Runs one queued Backup Job end to end and records the outcome on the Backup
 * row. A failed Backup is visible in the dashboard and audited, because losing
 * the recovery window silently is the dangerous case.
 */
export async function runBackupJob(job: {
  id: string;
  payload: { backupId?: string };
}): Promise<{ status: "completed" | "failed" }> {
  const backupId = job.payload.backupId;
  if (!backupId) {
    throw new Error("Backup Job is missing its backupId.");
  }

  const row = await loadBackup(backupId);
  // The Project may have been deleted after the Job was queued; nothing to do.
  if (!row) {
    return { status: "completed" };
  }
  if (row.status === "completed") {
    return { status: "completed" };
  }

  await pool.query(
    `UPDATE "backup" SET "status" = 'running', "errorMessage" = NULL WHERE "id" = $1`,
    [backupId],
  );

  const storage = createBackupStorage();
  const client = createAgentClient(nodeConfig().baseUrl, nodeConfig().token);

  try {
    const created = await client.POST("/v1/backups", { body: agentRequestFor(row) });
    if (!created.response.ok || !created.data) {
      throw new Error(
        `the Node Agent rejected the Backup (${created.response.status})`,
      );
    }

    const bytes = await downloadBackup(backupId);
    const storageKey = backupStorageKey(row);
    await storage.put(storageKey, bytes);

    // The agent copy is only a staging file; a failure here must not fail the
    // Backup, because the durable copy already exists.
    await client
      .DELETE("/v1/backups/{backupId}", { params: { path: { backupId } } })
      .catch(() => undefined);

    await pool.query(
      `UPDATE "backup"
       SET "status" = 'completed', "storageKey" = $2, "storageProvider" = $3,
           "sizeBytes" = $4, "errorMessage" = NULL
       WHERE "id" = $1`,
      [backupId, storageKey, storage.provider, bytes.length],
    );

    return { status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(
      `UPDATE "backup" SET "status" = 'failed', "errorMessage" = $2 WHERE "id" = $1`,
      [backupId, message],
    );

    if (row.organizationId) {
      await recordAudit("backup.failed", row.organizationId, null, undefined, {
        backupId,
        targetType: row.targetType,
        targetId: row.targetId,
        error: message,
      }).catch((auditError) => {
        console.error("could not record the failed Backup", auditError);
      });
    }

    return { status: "failed" };
  }
}

async function removeStoredObject(
  storageKey: string | null,
  provider: BackupStorageProvider | null,
): Promise<void> {
  if (!storageKey || !provider) {
    return;
  }

  if (provider === "local") {
    // The local directory is fixed, so this works even if S3 credentials were
    // added after the Backup was taken.
    await createLocalBackupStorage().remove(storageKey);
    return;
  }

  if (!hasS3Credentials(backupStorageConfigFromEnv())) {
    // Credentials were removed after the Backup was taken. The metadata still
    // expires; the object is left for the operator to clean up deliberately.
    console.warn(`cannot remove S3 Backup ${storageKey} without credentials`);
    return;
  }

  await createBackupStorage().remove(storageKey);
}

/**
 * Deletes Backups whose seven days are up, object first so a failed removal can
 * be retried on the next pass. Returns how many metadata rows were removed.
 */
export async function pruneBackups(now: Date = new Date()): Promise<{ removed: number }> {
  const expired = await pool.query<{
    id: string;
    storageKey: string | null;
    storageProvider: BackupStorageProvider | null;
  }>(
    `SELECT "id", "storageKey", "storageProvider" FROM "backup"
     WHERE "expiresAt" <= $1
     ORDER BY "expiresAt"`,
    [now],
  );

  let removed = 0;

  for (const row of expired.rows) {
    try {
      await removeStoredObject(row.storageKey, row.storageProvider);
    } catch (error) {
      console.error(`could not remove the stored Backup ${row.id}`, error);
      continue;
    }

    await pool.query('DELETE FROM "backup" WHERE "id" = $1', [row.id]);
    removed += 1;
  }

  return { removed };
}

/** The storage provider a newly scheduled Backup would use. */
export function currentBackupStorageProvider(): BackupStorageProvider {
  return hasS3Credentials(backupStorageConfigFromEnv()) ? "s3" : "local";
}

type BackupListRow = BackupRow & {
  projectName: string | null;
  serviceName: string | null;
};

function targetName(row: BackupListRow): string {
  return backupTargetName(row);
}

/**
 * The name the dashboard shows for a Backup target and the string a Restore
 * asks the user to type. It lives here so the Backup list, the Restore list, and
 * the confirmation check can never disagree.
 */
export function backupTargetName(row: {
  targetType: BackupTargetType;
  serviceName: string | null;
}): string {
  if (row.targetType === "database") {
    return "PostgreSQL Database";
  }
  if (row.targetType === "volume") {
    return `${row.serviceName ?? "Service"} Volume`;
  }

  return "Platform PostgreSQL";
}

/**
 * Lists the Organization's Backups plus the platform Backups, newest first. The
 * platform rows have no owner but are shown so a failed Control Plane Backup is
 * visible instead of silent.
 */
export async function listBackups(organizationId: string): Promise<BackupList> {
  const result = await pool.query<BackupListRow>(
    `SELECT b."id", b."organizationId", b."projectId", b."targetType",
            b."targetId", b."status", b."storageKey", b."storageProvider",
            b."sizeBytes", b."errorMessage", b."createdAt", b."expiresAt",
            p."name" AS "projectName", s."name" AS "serviceName"
     FROM "backup" b
     LEFT JOIN "project" p ON p."id" = b."projectId"
     LEFT JOIN "volume" v
       ON b."targetType" = 'volume' AND v."dockerVolumeName" = b."targetId"
     LEFT JOIN "service" s ON s."id" = v."serviceId"
     WHERE b."organizationId" = $1 OR b."organizationId" IS NULL
     ORDER BY b."createdAt" DESC`,
    [organizationId],
  );

  return {
    storageProvider: currentBackupStorageProvider(),
    backups: result.rows.map((row) => ({
      id: row.id,
      targetType: row.targetType,
      targetName: targetName(row),
      projectName: row.projectName,
      status: row.status,
      storageProvider: row.storageProvider,
      sizeBytes: Number(row.sizeBytes),
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    })),
  };
}

export { safeLocalPath };
