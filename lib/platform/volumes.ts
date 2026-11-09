import { Pool } from "pg";
import { createAgentClient } from "../../lib/agent-client.ts";
import { ApiError } from "./api-error.ts";
import { nodeConfig } from "./nodes.ts";

/**
 * A Service's persistent Volume. The Control Plane owns the row that records the
 * mount path and size; the Node Agent owns the Docker Volume, creates it on the
 * first Deployment that needs it, mounts it at the same path on every redeploy,
 * and enforces the size limit on the node.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** The spec limit for one Service Volume. */
export const MAX_VOLUME_SIZE_MB = 1024;

/** Absolute path segments made of characters that are safe in `--mount`. */
const MOUNT_PATH_PATTERN = /^\/[A-Za-z0-9._/-]+$/;

export type VolumeSummary = {
  id: string;
  serviceId: string;
  mountPath: string;
  sizeMb: number;
  /** Measured by the Node Agent; null when the node could not be asked. */
  usageMb: number | null;
  /** False until the first Deployment created the Docker Volume. */
  exists: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ServiceVolume = {
  volume: VolumeSummary | null;
  /** True when a Volume change is saved but not live yet. */
  needsRedeploy: boolean;
};

type VolumeRow = {
  id: string;
  serviceId: string;
  dockerVolumeName: string;
  mountPath: string;
  sizeMb: number;
  createdAt: Date;
  updatedAt: Date;
};

const VOLUME_COLUMNS = `"id", "serviceId", "dockerVolumeName", "mountPath", "sizeMb", "createdAt", "updatedAt"`;

/**
 * Confirms the Service is visible to the caller's Organization before any read
 * or write, so a Service id from another tenant always answers 404.
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

/**
 * Validates the mount path. It must be absolute and must not escape or shadow
 * the container root, and it is restricted to characters that cannot break the
 * `--mount` argument the agent builds from it.
 */
export function normalizeMountPath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "invalid_mount_path", "A Volume mount path is required.");
  }

  const trimmed = value.trim();
  const mountPath = trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
  const segments = mountPath.split("/").filter(Boolean);

  if (
    mountPath.length > 255 ||
    mountPath === "/" ||
    !MOUNT_PATH_PATTERN.test(mountPath) ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new ApiError(
      400,
      "invalid_mount_path",
      "The mount path must be an absolute path such as /data, using letters, numbers, dots, dashes, and underscores.",
    );
  }

  return mountPath;
}

/** The size is optional and defaults to the 1 GB platform limit. */
export function normalizeSizeMb(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return MAX_VOLUME_SIZE_MB;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_VOLUME_SIZE_MB
  ) {
    throw new ApiError(
      400,
      "invalid_volume_size",
      `The Volume size must be a whole number of MB between 1 and ${MAX_VOLUME_SIZE_MB}.`,
    );
  }

  return value;
}

/** The Docker Volume name is derived from the Service id, so it never moves. */
function dockerVolumeName(serviceId: string): string {
  return `stealth-vol-${serviceId}`;
}

/**
 * Bumps the Service's configuration revision, which is what `needsRedeploy`
 * compares against the newest running Deployment. It is shared with Environment
 * Variables so one redeploy applies every pending configuration change.
 */
async function bumpRevision(serviceId: string): Promise<void> {
  await pool.query('UPDATE "service" SET "envRevision" = "envRevision" + 1 WHERE "id" = $1', [
    serviceId,
  ]);
}

async function loadVolumeRow(serviceId: string): Promise<VolumeRow | null> {
  const result = await pool.query<VolumeRow>(
    `SELECT ${VOLUME_COLUMNS} FROM "volume" WHERE "serviceId" = $1`,
    [serviceId],
  );

  return result.rows[0] ?? null;
}

/**
 * Reads the usage from the Node Agent. A node that cannot be reached is not an
 * error for the dashboard: the Volume is still configured, the usage is just
 * unknown until the agent answers again.
 */
async function measureVolume(row: VolumeRow): Promise<{ usageMb: number | null; exists: boolean }> {
  try {
    const client = createAgentClient(nodeConfig().baseUrl, nodeConfig().token);
    const response = await client.GET("/v1/volumes/{name}", {
      params: {
        path: { name: row.dockerVolumeName },
        query: { sizeMb: row.sizeMb },
      },
    });

    if (response.response.ok && response.data) {
      return { usageMb: response.data.usageMb, exists: response.data.exists };
    }
    if (response.response.status === 404) {
      return { usageMb: 0, exists: false };
    }
  } catch (error) {
    console.error(`could not read the usage of Volume ${row.dockerVolumeName}`, error);
  }

  return { usageMb: null, exists: false };
}

function toSummary(
  row: VolumeRow,
  measurement: { usageMb: number | null; exists: boolean },
): VolumeSummary {
  return {
    id: row.id,
    serviceId: row.serviceId,
    mountPath: row.mountPath,
    sizeMb: row.sizeMb,
    usageMb: measurement.usageMb,
    exists: measurement.exists,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadNeedsRedeploy(serviceId: string): Promise<boolean> {
  const result = await pool.query<{ needsRedeploy: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM "deployment" rd
       WHERE rd."serviceId" = s."id" AND rd."status" = 'running'
     ) AND s."envRevision" > COALESCE((
       SELECT max(rd."envRevision") FROM "deployment" rd
       WHERE rd."serviceId" = s."id" AND rd."status" = 'running'
     ), 0) AS "needsRedeploy"
     FROM "service" s WHERE s."id" = $1`,
    [serviceId],
  );

  return result.rows[0]?.needsRedeploy ?? false;
}

/**
 * Returns the Service's Volume with the usage the node measures. A Service that
 * has no Volume answers `volume: null` rather than 404, so the dashboard can
 * render the empty state without treating it as an error.
 */
export async function getServiceVolume(
  organizationId: string,
  serviceId: string,
): Promise<ServiceVolume> {
  await requireService(organizationId, serviceId);

  const row = await loadVolumeRow(serviceId);
  const needsRedeploy = await loadNeedsRedeploy(serviceId);

  if (!row) {
    return { volume: null, needsRedeploy };
  }

  return { volume: toSummary(row, await measureVolume(row)), needsRedeploy };
}

/**
 * Records the one Volume a Service may have. The Docker Volume itself is created
 * by the agent on the next Deployment, which is also where the Deployment label
 * comes from.
 */
export async function createServiceVolume(input: {
  organizationId: string;
  serviceId: string;
  mountPath: unknown;
  sizeMb?: unknown;
}): Promise<VolumeSummary> {
  const mountPath = normalizeMountPath(input.mountPath);
  const sizeMb = normalizeSizeMb(input.sizeMb);

  await requireService(input.organizationId, input.serviceId);

  try {
    const inserted = await pool.query<VolumeRow>(
      `INSERT INTO "volume" ("id", "serviceId", "dockerVolumeName", "mountPath", "sizeMb")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
       RETURNING ${VOLUME_COLUMNS}`,
      [input.serviceId, dockerVolumeName(input.serviceId), mountPath, sizeMb],
    );

    await bumpRevision(input.serviceId);

    return toSummary(inserted.rows[0], { usageMb: 0, exists: false });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError(409, "volume_exists", "This Service already has a Volume.");
    }
    throw error;
  }
}

/**
 * Deletes the Volume and its data. The agent is asked first: a node that cannot
 * remove the data must not leave the user thinking it is gone, so the row stays
 * and the request can be retried.
 */
export async function deleteServiceVolume(input: {
  organizationId: string;
  serviceId: string;
}): Promise<{ id: string; serviceId: string; dockerVolumeName: string }> {
  await requireService(input.organizationId, input.serviceId);

  const row = await loadVolumeRow(input.serviceId);
  if (!row) {
    throw new ApiError(404, "volume_not_found", "This Service has no Volume.");
  }

  try {
    const client = createAgentClient(nodeConfig().baseUrl, nodeConfig().token);
    const response = await client.DELETE("/v1/volumes/{name}", {
      params: { path: { name: row.dockerVolumeName } },
    });

    if (response.response.status === 409) {
      throw new ApiError(409, "volume_in_use", "Stop the Service before deleting its Volume.");
    }
    if (!response.response.ok) {
      throw new Error(`The Node Agent answered ${response.response.status}.`);
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    console.error(`could not remove Volume ${row.dockerVolumeName}`, error);
    throw new ApiError(
      502,
      "volume_removal_failed",
      "The Node Agent could not remove the Volume. Try again when the node is healthy.",
    );
  }

  await pool.query('DELETE FROM "volume" WHERE "id" = $1 AND "serviceId" = $2', [
    row.id,
    input.serviceId,
  ]);
  await bumpRevision(input.serviceId);

  return { id: row.id, serviceId: input.serviceId, dockerVolumeName: row.dockerVolumeName };
}

/**
 * Reads the Volume a Deployment should mount, in the shape the Node Agent's
 * `DeployRequest.volume` expects. The agent creates and labels the Docker Volume
 * with this Deployment's id on the first run.
 */
export async function loadDeploymentVolume(serviceId: string): Promise<{
  name: string;
  mountPath: string;
  sizeMb: number;
} | null> {
  const row = await loadVolumeRow(serviceId);
  if (!row) {
    return null;
  }

  return {
    name: row.dockerVolumeName,
    mountPath: row.mountPath,
    sizeMb: row.sizeMb,
  };
}
