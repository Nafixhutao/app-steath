import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { createAgentClient } from "../../lib/agent-client.ts";
import { ApiError } from "./api-error.ts";
import { nodeConfig } from "./nodes.ts";
import { QUOTAS } from "./quota-limits.ts";
import { decryptSecret, encryptSecret } from "./secrets.ts";

/**
 * A Project's one PostgreSQL Database. The Control Plane owns the row with the
 * credentials and the storage limit; the Node Agent runs the container on the
 * Project network with its own Volume, so only Services in the same Project can
 * reach it. The password is sealed with the platform encryption key before it
 * reaches the database.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** The spec limit for one Database. */
export const MAX_DATABASE_STORAGE_MB = 1024;

/** The only engine and version the platform supports. */
export const DATABASE_ENGINE = "postgres";
export const DATABASE_VERSION = "16";

/** Default database name and role. Kept short because they appear in the URL. */
const DEFAULT_DATABASE_NAME = "app";
const DEFAULT_USERNAME = "app";

/** The alias the agent gives the container on the Project network. */
const DATABASE_HOSTNAME = "db";
const DATABASE_PORT = 5432;

export type DatabaseStatus = "provisioning" | "running" | "stopped" | "failed";

export type DatabaseSummary = {
  id: string;
  projectId: string;
  engine: "postgres";
  version: "16";
  databaseName: string;
  username: string;
  storageLimitMb: number;
  status: DatabaseStatus;
  /** True when PostgreSQL answers `pg_isready` on the node. */
  healthy: boolean;
  /** Measured by the Node Agent; null when the node could not be asked. */
  usageMb: number | null;
  overQuota: boolean;
  /** The private URL; only owners and admins receive it, members get null. */
  connectionString: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OrganizationDatabaseSummary = DatabaseSummary & { projectName: string };

export type ProjectDatabase = {
  database: DatabaseSummary | null;
  /** True when a credential or existence change is not live yet. */
  needsRedeploy: boolean;
};

type DatabaseRow = {
  id: string;
  projectId: string;
  engine: string;
  version: string;
  databaseName: string;
  username: string;
  encryptedPassword: string;
  storageLimitMb: number;
  status: DatabaseStatus;
  createdAt: Date;
  updatedAt: Date;
};

const DATABASE_COLUMNS = `"id", "projectId", "engine", "version", "databaseName", "username",
  "encryptedPassword", "storageLimitMb", "status", "createdAt", "updatedAt"`;

const PREFIXED_DATABASE_COLUMNS = `d."id", d."projectId", d."engine", d."version", d."databaseName",
  d."username", d."encryptedPassword", d."storageLimitMb", d."status", d."createdAt", d."updatedAt"`;

type Measurement = {
  status: DatabaseStatus;
  healthy: boolean;
  usageMb: number | null;
  overQuota: boolean;
};

/**
 * Confirms the Project is visible to the caller's Organization before any read
 * or write, so a Project id from another tenant always answers 404.
 */
async function requireProject(
  organizationId: string,
  projectId: string,
): Promise<{ id: string; name: string }> {
  const result = await pool.query<{ id: string; name: string }>(
    'SELECT "id", "name" FROM "project" WHERE "organizationId" = $1 AND "id" = $2',
    [organizationId, projectId],
  );

  if (!result.rowCount) {
    throw new ApiError(404, "project_not_found", "Project not found.");
  }

  return result.rows[0];
}

async function loadDatabaseRow(projectId: string): Promise<DatabaseRow | null> {
  const result = await pool.query<DatabaseRow>(
    `SELECT ${DATABASE_COLUMNS} FROM "database" WHERE "projectId" = $1`,
    [projectId],
  );

  return result.rows[0] ?? null;
}

/** The storage limit is optional and defaults to the 1 GB platform limit. */
export function normalizeStorageLimitMb(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return MAX_DATABASE_STORAGE_MB;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_DATABASE_STORAGE_MB
  ) {
    throw new ApiError(
      400,
      "invalid_database_storage",
      `The Database storage limit must be a whole number of MB between 1 and ${MAX_DATABASE_STORAGE_MB}.`,
    );
  }

  return value;
}

function quotaError(limit: number, usage: number): ApiError {
  return new ApiError(
    409,
    "quota_exceeded",
    `Database Quota reached: this Project uses ${usage} of ${limit} allowed Databases.`,
    { resource: "database", scope: "project", limit, usage },
  );
}

/**
 * The private connection string. It uses the Project network alias, never a host
 * port, so it only resolves for Services in the same Project.
 */
function buildConnectionString(row: DatabaseRow, password: string): string {
  return `postgres://${encodeURIComponent(row.username)}:${encodeURIComponent(password)}@${DATABASE_HOSTNAME}:${DATABASE_PORT}/${encodeURIComponent(row.databaseName)}`;
}

function decryptPassword(row: DatabaseRow): string {
  return decryptSecret(row.encryptedPassword);
}

/**
 * Reads health and usage from the Node Agent. A node that cannot be reached is
 * not an error for the dashboard: the Database is still configured, the health
 * is just unknown until the agent answers again.
 */
async function measureDatabase(row: DatabaseRow): Promise<Measurement> {
  try {
    const client = createAgentClient(nodeConfig().baseUrl, nodeConfig().token);
    const response = await client.GET("/v1/databases/{databaseId}", {
      params: {
        path: { databaseId: row.id },
        query: { storageLimitMb: row.storageLimitMb },
      },
    });

    if (response.response.ok && response.data) {
      return {
        status: mapAgentStatus(response.data.status),
        healthy: response.data.healthy,
        usageMb: response.data.usageMb,
        overQuota: response.data.overQuota ?? false,
      };
    }
    if (response.response.status === 404) {
      return { status: "failed", healthy: false, usageMb: 0, overQuota: false };
    }
  } catch (error) {
    console.error(`could not read the state of Database ${row.id}`, error);
  }

  return {
    status: row.status === "provisioning" ? "provisioning" : row.status,
    healthy: false,
    usageMb: null,
    overQuota: false,
  };
}

function mapAgentStatus(status: string): DatabaseStatus {
  switch (status) {
    case "running":
      return "running";
    case "stopped":
      return "stopped";
    default:
      // `absent` and `failed` both mean the Database is not serving.
      return "failed";
  }
}

async function persistStatus(row: DatabaseRow, status: DatabaseStatus): Promise<void> {
  if (row.status === status || status === "provisioning") {
    return;
  }

  await pool.query('UPDATE "database" SET "status" = $2 WHERE "id" = $1', [row.id, status]);
  row.status = status;
}

function toSummary(
  row: DatabaseRow,
  measurement: Measurement,
  includeConnectionString: boolean,
): DatabaseSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    engine: "postgres",
    version: "16",
    databaseName: row.databaseName,
    username: row.username,
    storageLimitMb: row.storageLimitMb,
    status: measurement.status,
    healthy: measurement.healthy,
    usageMb: measurement.usageMb,
    overQuota: measurement.overQuota,
    connectionString: includeConnectionString
      ? buildConnectionString(row, decryptPassword(row))
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * True when at least one running Service in the Project was deployed before the
 * newest credential change. The Database panel repeats the redeploy banner so a
 * rotated password is not silently stale in a running container.
 */
async function loadNeedsRedeploy(projectId: string): Promise<boolean> {
  const result = await pool.query<{ needsRedeploy: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM "service" s
       WHERE s."projectId" = $1
         AND EXISTS (
           SELECT 1 FROM "deployment" rd
           WHERE rd."serviceId" = s."id" AND rd."status" = 'running'
         )
         AND s."envRevision" > COALESCE((
           SELECT max(rd."envRevision") FROM "deployment" rd
           WHERE rd."serviceId" = s."id" AND rd."status" = 'running'
         ), 0)
     ) AS "needsRedeploy"`,
    [projectId],
  );

  return result.rows[0]?.needsRedeploy ?? false;
}

/**
 * Bumps the configuration revision of every Service in the Project, so the
 * dashboard shows that a Database change needs a redeploy to take effect.
 */
async function bumpProjectRevisions(projectId: string): Promise<void> {
  await pool.query(
    'UPDATE "service" SET "envRevision" = "envRevision" + 1 WHERE "projectId" = $1',
    [projectId],
  );
}

/**
 * Returns the Project's Database with the health the node reports. A Project
 * without a Database answers `database: null` rather than 404, so the dashboard
 * can render the empty state.
 */
export async function getProjectDatabase(input: {
  organizationId: string;
  projectId: string;
  includeConnectionString: boolean;
}): Promise<ProjectDatabase> {
  await requireProject(input.organizationId, input.projectId);

  const row = await loadDatabaseRow(input.projectId);
  const needsRedeploy = await loadNeedsRedeploy(input.projectId);

  if (!row) {
    return { database: null, needsRedeploy };
  }

  const measurement = await measureDatabase(row);
  await persistStatus(row, measurement.status);

  return {
    database: toSummary(row, measurement, input.includeConnectionString),
    needsRedeploy,
  };
}

/**
 * Lists every Database in an Organization for the Databases page. Each row also
 * carries its Project name so the dashboard can link back.
 */
export async function listOrganizationDatabases(
  organizationId: string,
  includeConnectionString: boolean,
): Promise<OrganizationDatabaseSummary[]> {
  const result = await pool.query<DatabaseRow & { projectName: string }>(
    `SELECT ${PREFIXED_DATABASE_COLUMNS}, p."name" AS "projectName"
     FROM "database" d JOIN "project" p ON p."id" = d."projectId"
     WHERE p."organizationId" = $1
     ORDER BY p."createdAt", d."createdAt", d."id"`,
    [organizationId],
  );

  const summaries: OrganizationDatabaseSummary[] = [];
  for (const row of result.rows) {
    const measurement = await measureDatabase(row);
    await persistStatus(row, measurement.status);
    summaries.push({
      ...toSummary(row, measurement, includeConnectionString),
      projectName: row.projectName,
    });
  }

  return summaries;
}

/**
 * Provisions the Project's one Database. The password is generated here, sealed
 * before it is stored, and only ever sent to the Node Agent in the request body.
 * A failed provisioning removes the row so the user can try again.
 */
export async function createProjectDatabase(input: {
  organizationId: string;
  projectId: string;
  storageLimitMb?: unknown;
}): Promise<DatabaseSummary> {
  const storageLimitMb = normalizeStorageLimitMb(input.storageLimitMb);
  const project = await requireProject(input.organizationId, input.projectId);

  const existing = await loadDatabaseRow(input.projectId);
  if (existing) {
    throw quotaError(QUOTAS.databasesPerProject, QUOTAS.databasesPerProject);
  }

  const password = randomBytes(32).toString("hex");
  const encryptedPassword = encryptSecret(password);

  let row: DatabaseRow;
  try {
    const inserted = await pool.query<DatabaseRow>(
      `INSERT INTO "database" ("id", "projectId", "engine", "version", "databaseName",
         "username", "encryptedPassword", "storageLimitMb", "status")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, 'provisioning')
       RETURNING ${DATABASE_COLUMNS}`,
      [
        input.projectId,
        DATABASE_ENGINE,
        DATABASE_VERSION,
        DEFAULT_DATABASE_NAME,
        DEFAULT_USERNAME,
        encryptedPassword,
        storageLimitMb,
      ],
    );
    row = inserted.rows[0];
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw quotaError(QUOTAS.databasesPerProject, QUOTAS.databasesPerProject);
    }
    throw error;
  }

  try {
    const state = await provisionDatabase(row, project.id, input.organizationId, password);
    await persistStatus(row, state);
  } catch (error) {
    // The row must not survive a provisioning failure, or the Project would be
    // stuck at its Quota with a Database the user cannot use.
    await pool.query('DELETE FROM "database" WHERE "id" = $1', [row.id]).catch(() => undefined);
    await removeDatabaseOnNode(row.id).catch(() => undefined);
    throw error;
  }

  await bumpProjectRevisions(input.projectId);

  const measurement: Measurement = {
    status: row.status,
    healthy: row.status === "running",
    usageMb: 0,
    overQuota: false,
  };

  return toSummary(row, measurement, true);
}

async function provisionDatabase(
  row: DatabaseRow,
  projectId: string,
  organizationId: string,
  password: string,
): Promise<DatabaseStatus> {
  try {
    const client = createAgentClient(nodeConfig().baseUrl, nodeConfig().token);
    const response = await client.PUT("/v1/databases/{databaseId}", {
      params: { path: { databaseId: row.id } },
      body: {
        databaseId: row.id,
        projectId,
        organizationId,
        databaseName: row.databaseName,
        username: row.username,
        password,
        storageLimitMb: row.storageLimitMb,
      },
    });

    if (!response.response.ok || !response.data) {
      throw new ApiError(
        502,
        "database_provisioning_failed",
        `The Node Agent rejected the Database (${response.response.status}).`,
      );
    }

    return mapAgentStatus(response.data.status);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    console.error(`could not provision Database ${row.id}`, error);
    throw new ApiError(
      502,
      "database_provisioning_failed",
      "The Node Agent could not start the Database. Try again when the node is healthy.",
    );
  }
}

async function removeDatabaseOnNode(databaseId: string): Promise<void> {
  const client = createAgentClient(nodeConfig().baseUrl, nodeConfig().token);
  await client.DELETE("/v1/databases/{databaseId}", {
    params: { path: { databaseId } },
  });
}

/**
 * Deletes the Project's Database and its data after the caller types the Project
 * name. The agent is asked first: a node that cannot remove the data must not
 * leave the user thinking it is gone.
 */
export async function deleteProjectDatabase(input: {
  organizationId: string;
  projectId: string;
  confirmation: unknown;
}): Promise<{ id: string; projectId: string; engine: string; version: string }> {
  const project = await requireProject(input.organizationId, input.projectId);

  if (typeof input.confirmation !== "string" || !input.confirmation.trim()) {
    throw new ApiError(400, "confirmation_required", "Project name confirmation is required.");
  }
  if (input.confirmation.trim() !== project.name) {
    throw new ApiError(
      400,
      "confirmation_mismatch",
      "The confirmation text does not match the Project name.",
    );
  }

  const row = await loadDatabaseRow(input.projectId);
  if (!row) {
    throw new ApiError(404, "database_not_found", "This Project has no Database.");
  }

  try {
    const client = createAgentClient(nodeConfig().baseUrl, nodeConfig().token);
    const response = await client.DELETE("/v1/databases/{databaseId}", {
      params: { path: { databaseId: row.id } },
    });

    if (!response.response.ok && response.response.status !== 404) {
      throw new Error(`The Node Agent answered ${response.response.status}.`);
    }
  } catch (error) {
    console.error(`could not remove Database ${row.id}`, error);
    throw new ApiError(
      502,
      "database_removal_failed",
      "The Node Agent could not remove the Database. Try again when the node is healthy.",
    );
  }

  await pool.query('DELETE FROM "database" WHERE "id" = $1 AND "projectId" = $2', [
    row.id,
    input.projectId,
  ]);
  await bumpProjectRevisions(input.projectId);

  return {
    id: row.id,
    projectId: input.projectId,
    engine: row.engine,
    version: row.version,
  };
}

/**
 * Replaces the Database password. The agent changes the role inside the running
 * cluster, then the sealed value is replaced so the next Deployment injects the
 * new `DATABASE_URL`.
 */
export async function rotateProjectDatabaseCredentials(input: {
  organizationId: string;
  projectId: string;
}): Promise<DatabaseSummary> {
  await requireProject(input.organizationId, input.projectId);

  const row = await loadDatabaseRow(input.projectId);
  if (!row) {
    throw new ApiError(404, "database_not_found", "This Project has no Database.");
  }

  const password = randomBytes(32).toString("hex");
  try {
    const client = createAgentClient(nodeConfig().baseUrl, nodeConfig().token);
    const response = await client.POST("/v1/databases/{databaseId}/rotate", {
      params: { path: { databaseId: row.id } },
      body: {
        databaseName: row.databaseName,
        username: row.username,
        password,
      },
    });

    if (response.response.status === 404) {
      throw new ApiError(
        409,
        "database_not_running",
        "Start the Database before rotating its credentials.",
      );
    }
    if (!response.response.ok) {
      throw new ApiError(
        502,
        "database_rotation_failed",
        `The Node Agent rejected the rotation (${response.response.status}).`,
      );
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    console.error(`could not rotate the credentials of Database ${row.id}`, error);
    throw new ApiError(
      502,
      "database_rotation_failed",
      "The Node Agent could not rotate the credentials. Try again when the node is healthy.",
    );
  }

  const encryptedPassword = encryptSecret(password);
  await pool.query('UPDATE "database" SET "encryptedPassword" = $2 WHERE "id" = $1', [
    row.id,
    encryptedPassword,
  ]);
  row.encryptedPassword = encryptedPassword;
  await bumpProjectRevisions(input.projectId);

  const measurement = await measureDatabase(row);

  return toSummary(row, measurement, true);
}

/**
 * Reads the `DATABASE_URL` a Deployment must receive. It is built from the
 * stored password at deploy time, so a running container only ever sees the
 * value that was current when it started.
 */
export async function loadDeploymentDatabaseUrl(projectId: string): Promise<string | null> {
  const row = await loadDatabaseRow(projectId);
  if (!row) {
    return null;
  }

  return buildConnectionString(row, decryptPassword(row));
}
