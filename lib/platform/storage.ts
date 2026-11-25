import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "./db.ts";
import { ApiError } from "./api-error.ts";
import { nodeAgent } from "./node-agent.ts";
import { QUOTAS } from "./quota-limits.ts";
import { assertQuota } from "./quota.ts";
import { requireProject } from "./ownership.ts";
import { decryptSecret, encryptSecret } from "./secrets.ts";
import { getPlatformDomain } from "./platform-domain.ts";

/**
 * S3-compatible Object Storage for a Project. The Control Plane owns the row —
 * the user-facing name, the generated Access Key, and the secret sealed with
 * the platform key. The Node Agent owns the objects inside the one shared MinIO
 * server: the physical bucket, its hard quota, its IAM user, and its policy.
 *
 * The split mirrors Databases (ADR-0012). A bucket per Project container would
 * spend hundreds of MB on the VPS before a single object was uploaded, so all
 * tenants live in one server and isolation lives in its IAM policies.
 */

/** The spec limit for one Bucket. MinIO enforces it as a hard bucket quota. */
export const MAX_BUCKET_SIZE_MB = QUOTAS.bucketStorageMb;

/** DNS-compatible S3 bucket names: 3-63 lowercase letters, digits and dashes. */
const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export type StorageBucketStatus = "provisioning" | "ready" | "failed";

export type StorageBucketSummary = {
  id: string;
  projectId: string;
  name: string;
  /** Physical MinIO bucket name; derived from the id and never changes. */
  objectName: string;
  public: boolean;
  status: StorageBucketStatus;
  quotaMb: number;
  /** Measured by the Node Agent; null when the node could not be asked. */
  usageMb: number | null;
  healthy: boolean;
  /** Public S3 endpoint. Path-style URLs append the physical bucket name. */
  endpoint: string;
  accessKey: string;
  createdAt: Date;
  updatedAt: Date;
};

type BucketRow = {
  id: string;
  projectId: string;
  name: string;
  objectName: string;
  accessKey: string;
  encryptedSecretKey: string;
  public: boolean;
  quotaMb: number;
  status: StorageBucketStatus;
  createdAt: Date;
  updatedAt: Date;
};

const BUCKET_COLUMNS = `"id", "projectId", "name", "objectName", "accessKey",
  "encryptedSecretKey", "public", "quotaMb", "status", "createdAt", "updatedAt"`;

/**
 * Derives node-wide unique object names from the Bucket id, using the same
 * 24-character id shape as `databaseObjectNames`. Both the Control Plane and
 * the Agent receive these names, so neither has to ask the other what it made.
 *
 * The Access Key is shorter on purpose: MinIO's older IAM check limits keys to
 * 20 characters, while the physical bucket name has no such limit.
 */
export function storageObjectNames(bucketId: string): { bucket: string; accessKey: string } {
  const short = bucketId.replace(/-/g, "");
  return { bucket: `sb-${short.slice(0, 24)}`, accessKey: `ak${short.slice(0, 16)}` };
}

/** Validates the user-facing name. The physical name is never user-supplied. */
export function normalizeBucketName(value: unknown): string {
  if (typeof value !== "string" || !BUCKET_NAME_PATTERN.test(value.trim())) {
    throw new ApiError(
      400,
      "invalid_bucket_name",
      "The Bucket name must be 3-63 lowercase letters, numbers, or dashes, and must not start or end with a dash.",
    );
  }

  return value.trim();
}

/** The quota is optional and defaults to the platform's per-bucket limit. */
export function normalizeBucketQuotaMb(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return MAX_BUCKET_SIZE_MB;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_BUCKET_SIZE_MB
  ) {
    throw new ApiError(
      400,
      "invalid_bucket_quota",
      `The Bucket quota must be a whole number of MB between 1 and ${MAX_BUCKET_SIZE_MB}.`,
    );
  }

  return value;
}

function s3Endpoint(): string {
  return `https://s3.${getPlatformDomain()}`;
}

function toSummary(
  row: BucketRow,
  measurement: { usageMb: number | null; healthy: boolean; status: StorageBucketStatus },
): StorageBucketSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    objectName: row.objectName,
    public: row.public,
    status: measurement.status,
    quotaMb: row.quotaMb,
    usageMb: measurement.usageMb,
    healthy: measurement.healthy,
    endpoint: s3Endpoint(),
    accessKey: row.accessKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadBucketRow(projectId: string, bucketId: string): Promise<BucketRow | null> {
  const result = await pool.query<BucketRow>(
    `SELECT ${BUCKET_COLUMNS} FROM "storage_bucket" WHERE "id" = $1 AND "projectId" = $2`,
    [bucketId, projectId],
  );

  return result.rows[0] ?? null;
}

/**
 * Reads the node's live state. A node that cannot be asked leaves the row's
 * configured status in place and reports unknown usage, exactly as Volumes and
 * Databases do — the dashboard must still render a Bucket that is configured.
 */
async function measureBucket(row: BucketRow): Promise<{
  usageMb: number | null;
  healthy: boolean;
  status: StorageBucketStatus;
}> {
  try {
    const state = await nodeAgent.readStorageBucket({
      bucketId: row.objectName,
      quotaMb: row.quotaMb,
    });

    if (!state) {
      return { usageMb: 0, healthy: false, status: "failed" };
    }

    const status: StorageBucketStatus =
      state.status === "ready" || state.status === "provisioning" || state.status === "failed"
        ? state.status
        : row.status;

    return { usageMb: state.usageMb, healthy: state.healthy, status };
  } catch (error) {
    if (!(error instanceof ApiError)) {
      console.error(`could not read the state of Bucket ${row.objectName}`, error);
    }
  }

  return { usageMb: null, healthy: false, status: row.status };
}

/** Lists the Project's Buckets with the live state the node reports. */
export async function getProjectStorageBuckets(input: {
  organizationId: string;
  projectId: string;
}): Promise<{ buckets: StorageBucketSummary[]; endpoint: string }> {
  await requireProject(input.organizationId, input.projectId);

  const result = await pool.query<BucketRow>(
    `SELECT ${BUCKET_COLUMNS} FROM "storage_bucket"
     WHERE "projectId" = $1 ORDER BY "name" ASC`,
    [input.projectId],
  );

  const buckets: StorageBucketSummary[] = [];
  for (const row of result.rows) {
    buckets.push(toSummary(row, await measureBucket(row)));
  }

  return { buckets, endpoint: s3Endpoint() };
}

/**
 * Creates a Bucket and its key pair. The id is generated here because both the
 * physical bucket name and the Access Key are derived from it. The secret is
 * generated here, sealed before it is stored, and sent to the Agent in the
 * request body only. A failed provisioning removes the row so the Project does
 * not stay at its Bucket Quota with nothing to show for it.
 */
export async function createProjectStorageBucket(input: {
  organizationId: string;
  projectId: string;
  name: unknown;
  public?: unknown;
  quotaMb?: unknown;
}): Promise<StorageBucketSummary> {
  const name = normalizeBucketName(input.name);
  const quotaMb = normalizeBucketQuotaMb(input.quotaMb);
  if (input.public !== undefined && typeof input.public !== "boolean") {
    throw new ApiError(400, "invalid_bucket_visibility", "public must be true or false.");
  }
  const isPublic = input.public ?? false;

  await requireProject(input.organizationId, input.projectId);
  await assertQuota(pool, { type: "bucket", projectId: input.projectId });

  const id = randomUUID();
  const names = storageObjectNames(id);
  const secretKey = randomBytes(32).toString("hex");
  const encryptedSecretKey = encryptSecret(secretKey);

  try {
    await pool.query(
      `INSERT INTO "storage_bucket" ("id", "projectId", "name", "objectName", "accessKey",
         "encryptedSecretKey", "public", "quotaMb", "status")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'provisioning')`,
      [
        id,
        input.projectId,
        name,
        names.bucket,
        names.accessKey,
        encryptedSecretKey,
        isPublic,
        quotaMb,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError(409, "bucket_exists", "This Project already has a Bucket with that name.");
    }
    throw error;
  }

  try {
    const state = await nodeAgent.provisionStorageBucket({
      // The Agent's path parameter is the physical bucket name, which it
      // validates before touching MinIO. The row id stays internal to the DB.
      bucketId: names.bucket,
      bucketName: names.bucket,
      accessKey: names.accessKey,
      secretKey,
      public: isPublic,
      quotaMb,
    });

    await pool.query('UPDATE "storage_bucket" SET "status" = $1 WHERE "id" = $2', [
      state.status,
      id,
    ]);

    return toSummary((await loadBucketRow(input.projectId, id))!, {
      usageMb: state.usageMb,
      healthy: state.healthy,
      status: state.status,
    });
  } catch (error) {
    await pool.query('DELETE FROM "storage_bucket" WHERE "id" = $1', [id]).catch(() => undefined);
    await nodeAgent.removeStorageBucket(names.bucket).catch(() => undefined);
    throw error;
  }
}

/**
 * Deletes the Bucket and all of its objects. The Agent goes first: a node that
 * cannot remove the data must not leave the user believing it is gone, so the
 * row stays and the request can be retried. The confirmation must name the
 * Bucket, so an accidental click cannot destroy objects.
 */
export async function deleteProjectStorageBucket(input: {
  organizationId: string;
  projectId: string;
  bucketId: string;
  confirmation: unknown;
}): Promise<{ id: string; projectId: string; name: string }> {
  await requireProject(input.organizationId, input.projectId);
  if (typeof input.confirmation !== "string") {
    throw new ApiError(400, "invalid_confirmation", "Type the Bucket name to confirm deletion.");
  }

  const row = await loadBucketRow(input.projectId, input.bucketId);
  if (!row) {
    throw new ApiError(404, "bucket_not_found", "Bucket not found.");
  }
  if (input.confirmation.trim() !== row.name) {
    throw new ApiError(
      400,
      "invalid_confirmation",
      `Type "${row.name}" exactly to confirm deletion.`,
    );
  }

  await nodeAgent.removeStorageBucket(row.objectName);

  await pool.query('DELETE FROM "storage_bucket" WHERE "id" = $1 AND "projectId" = $2', [
    row.id,
    input.projectId,
  ]);

  return { id: row.id, projectId: input.projectId, name: row.name };
}

/**
 * Reveals the secret on demand for the Reveal button. It is never part of the
 * list payload, so the browser does not cache it with the dashboard state.
 */
export async function revealProjectStorageBucketSecret(input: {
  organizationId: string;
  projectId: string;
  bucketId: string;
}): Promise<{ accessKey: string; secretKey: string }> {
  await requireProject(input.organizationId, input.projectId);

  const row = await loadBucketRow(input.projectId, input.bucketId);
  if (!row) {
    throw new ApiError(404, "bucket_not_found", "Bucket not found.");
  }

  return { accessKey: row.accessKey, secretKey: decryptSecret(row.encryptedSecretKey) };
}
