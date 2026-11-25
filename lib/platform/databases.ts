import { randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { pool } from "./db.ts";
import { ApiError } from "./api-error.ts";
import { nodeAgent } from "./node-agent.ts";
import { getPlatformDomain } from "./platform-domain.ts";
import { assertQuota, QUOTAS, QuotaExceededError } from "./quota.ts";
import { decryptSecret, encryptSecret } from "./secrets.ts";
import { requireProject } from "./ownership.ts";
import { bumpProjectRevisions, projectNeedsRedeploy } from "./revisions.ts";

/**
 * A Project's one Database. The Control Plane owns the row with the credentials
 * and the storage limit; the Node Agent runs the container on the Project
 * network with its own Volume, so only Services in the same Project can reach
 * it. The password is sealed with the platform encryption key before it reaches
 * the database.
 *
 * Two engines are offered. PostgreSQL is the default and keeps the public TLS
 * proxy; MySQL cannot be proxied the same way, so it always ships with a
 * phpMyAdmin container on the Platform Domain instead.
 */

/** The spec limit for one Database. */
export const MAX_DATABASE_STORAGE_MB = QUOTAS.databaseStorageMb;

/** The engines a Project may choose from, and their pinned versions. */
export const DATABASE_ENGINES = {
  postgres: "16",
  mysql: "8",
} as const;

export type DatabaseEngine = keyof typeof DATABASE_ENGINES;

/** Kept for the code that only ever needs the default engine. */
export const DATABASE_ENGINE: DatabaseEngine = "postgres";
export const DATABASE_VERSION = DATABASE_ENGINES.postgres;

/**
 * Derives the schema and role for a Database id. The Agent derives the same
 * names with the same formula, so the connection string the Control Plane builds
 * always names the objects the Agent created inside the shared server. Both names
 * use a 24 character key from the id (96 bits of a UUID), which fits MySQL's
 * 32-character user name limit and is collision-free in practice.
 *
 * This is the legacy formula, kept for Databases that predate readable user
 * names. New Databases get `readableDatabaseRole` instead, and the Agent resolves
 * a Database's role from the server rather than assuming this one.
 */
export function databaseObjectNames(databaseId: string): { schema: string; role: string } {
  const key = databaseId.replace(/[^A-Za-z0-9]/g, "").slice(0, 24) || "tenant";

  return { schema: `db_${key}`, role: `u_${key}` };
}

/** MySQL caps a user name at 32 characters, so the readable role stays short. */
const READABLE_ROLE_SUFFIX_LENGTH = 6;
const READABLE_ROLE_MAX_PROJECT = 20;

/**
 * Builds the role a new Database signs in as: `{project}_{6 random base36}`, for
 * example `apap_a1b2c3`. A readable name is what makes phpMyAdmin usable without
 * the connection string, and the random suffix keeps it unique across a shared
 * server that holds every tenant.
 *
 * The suffix is random rather than derived from the id, because a collision would
 * make two Databases share one MySQL user. The caller checks the Database table
 * for a duplicate and retries, which keeps the name unpredictable and unique.
 *
 * The schema keeps the legacy `db_<key>` shape: it is derived from the id, never
 * shown to a person, and changing it would orphan rows that already exist.
 */
export function readableDatabaseRole(projectName: string, suffix: string): string {
  const prefix = projectName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, READABLE_ROLE_MAX_PROJECT)
    .replace(/_+$/g, "");

  return `${prefix || "db"}_${suffix.slice(0, READABLE_ROLE_SUFFIX_LENGTH)}`;
}

/** A lowercase base36 suffix sized for `READABLE_ROLE_SUFFIX_LENGTH`. */
export function readableRoleSuffix(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(READABLE_ROLE_SUFFIX_LENGTH);
  let suffix = "";
  for (const byte of bytes) {
    suffix += alphabet[byte % alphabet.length];
  }

  return suffix;
}

/**
 * Chooses a readable role no other Database already holds. A collision would give
 * two tenants the same MySQL user, so a duplicate is retried a few times before
 * giving up rather than silently reusing it.
 */
async function uniqueReadableRole(projectName: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = readableDatabaseRole(projectName, readableRoleSuffix());
    const existing = await pool.query('SELECT 1 FROM "database" WHERE "username" = $1', [
      candidate,
    ]);
    if (existing.rowCount === 0) {
      return candidate;
    }
  }

  throw new ApiError(
    503,
    "database_username_conflict",
    "Could not allocate a unique Database user name. Try again.",
  );
}

/** The alias the agent gives the container on the Project network. */
const DATABASE_HOSTNAME = "db";
const DATABASE_PORTS: Record<DatabaseEngine, number> = { postgres: 5432, mysql: 3306 };

/** The public proxy is only available on PostgreSQL, and only in this range. */
export const MIN_DATABASE_PROXY_PORT = 20000;
export const MAX_DATABASE_PROXY_PORT = 29999;

/** The generated nginx configuration stays bounded with this many entries. */
export const MAX_DATABASE_PROXY_ALLOWLIST = 50;

/**
 * phpMyAdmin lives on the Platform Domain, like a Platform Subdomain, but there
 * is only one of them: a single browser client serves every MySQL Database on
 * the node, so its address is fixed rather than allocated per Project.
 */
const PHPMYADMIN_LABEL = "pma";

/**
 * The one phpMyAdmin address for this Platform. The wildcard certificate and the
 * tunnel already cover it, so no per-Database address has to be managed.
 */
export function sharedPhpMyAdminHostname(): string {
  return `${PHPMYADMIN_LABEL}.${getPlatformDomain()}`;
}

export type DatabaseStatus = "provisioning" | "running" | "stopped" | "failed";

/**
 * The opt-in public endpoint for a Database. It is disabled by default, so a
 * new Database has no public port. The public connection string is only sent to
 * owners and admins.
 */
export type DatabaseProxySummary = {
  enabled: boolean;
  port: number | null;
  allowlist: string[];
  connectionString: string | null;
};

export type DatabaseSummary = {
  id: string;
  projectId: string;
  engine: DatabaseEngine;
  version: string;
  databaseName: string;
  username: string;
  storageLimitMb: number;
  status: DatabaseStatus;
  /** True when the engine answers its readiness probe on the node. */
  healthy: boolean;
  /** Measured by the Node Agent; null when the node could not be asked. */
  usageMb: number | null;
  overQuota: boolean;
  /** The private URL; only owners and admins receive it, members get null. */
  connectionString: string | null;
  /** The opt-in public TLS endpoint. PostgreSQL only. */
  proxy: DatabaseProxySummary;
  /** The browser client a MySQL Database always gets, at its Platform Domain. */
  phpMyAdmin: DatabasePhpMyAdminSummary;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * The phpMyAdmin sidecar of a MySQL Database. It is always present while the
 * Database is running, so the dashboard only needs the URL and its readiness.
 */
export type DatabasePhpMyAdminSummary = {
  enabled: boolean;
  /** Full URL on the Platform Domain, or null before the row was allocated. */
  url: string | null;
  hostname: string | null;
  /** True when the sidecar container answers; always false for PostgreSQL. */
  ready: boolean;
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
  engine: DatabaseEngine;
  version: string;
  databaseName: string;
  username: string;
  encryptedPassword: string;
  storageLimitMb: number;
  status: DatabaseStatus;
  phpMyAdminHostname: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const DATABASE_COLUMNS = `"id", "projectId", "engine", "version", "databaseName", "username",
  "encryptedPassword", "storageLimitMb", "status", "phpMyAdminHostname", "createdAt", "updatedAt"`;

const PREFIXED_DATABASE_COLUMNS = `d."id", d."projectId", d."engine", d."version", d."databaseName",
  d."username", d."encryptedPassword", d."storageLimitMb", d."status", d."phpMyAdminHostname",
  d."createdAt", d."updatedAt"`;

type DatabaseProxyRow = {
  databaseId: string;
  port: number;
  allowlist: string[];
  createdAt: Date;
  updatedAt: Date;
};

type Measurement = {
  status: DatabaseStatus;
  healthy: boolean;
  usageMb: number | null;
  overQuota: boolean;
  phpMyAdminReady: boolean;
};

/** The engine a Database request asks for, defaulting to PostgreSQL. */
export function normalizeEngine(value: unknown): DatabaseEngine {
  if (value === undefined || value === null || value === "") {
    return DATABASE_ENGINE;
  }
  if (value === "postgres" || value === "mysql") {
    return value;
  }

  throw new ApiError(
    400,
    "invalid_database_engine",
    'The Database engine must be "postgres" or "mysql".',
  );
}

async function loadDatabaseRow(projectId: string): Promise<DatabaseRow | null> {
  const result = await pool.query<DatabaseRow>(
    `SELECT ${DATABASE_COLUMNS} FROM "database" WHERE "projectId" = $1`,
    [projectId],
  );

  return result.rows[0] ?? null;
}

/**
 * Reads a Database's sign-in credentials by id, for the phpMyAdmin bridge. The
 * bridge has already verified a signed one-time token, so it does not carry a
 * user session; this is how it resolves the tenant the token names.
 */
export async function databaseSignInCredentials(
  databaseId: string,
): Promise<{ engine: DatabaseEngine; username: string; password: string } | null> {
  const result = await pool.query<DatabaseRow>(
    `SELECT ${DATABASE_COLUMNS} FROM "database" WHERE "id" = $1`,
    [databaseId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return { engine: row.engine, username: row.username, password: decryptPassword(row) };
}

async function loadProxyRow(databaseId: string): Promise<DatabaseProxyRow | null> {
  const result = await pool.query<DatabaseProxyRow>(
    'SELECT "databaseId", "port", "allowlist", "createdAt", "updatedAt" FROM "database_proxy" WHERE "databaseId" = $1',
    [databaseId],
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

/**
 * The private connection string. It uses the Project network alias, never a host
 * port, so it only resolves for Services in the same Project. MySQL carries
 * `?ssl-mode=REQUIRED` because the image has TLS on by default and the
 * application should not silently fall back to plaintext.
 */
function buildConnectionString(row: DatabaseRow, password: string): string {
  const port = DATABASE_PORTS[row.engine] ?? DATABASE_PORTS.postgres;
  const scheme = row.engine === "mysql" ? "mysql" : "postgres";
  const base = `${scheme}://${encodeURIComponent(row.username)}:${encodeURIComponent(password)}@${DATABASE_HOSTNAME}:${port}/${encodeURIComponent(row.databaseName)}`;

  return row.engine === "mysql" ? `${base}?ssl-mode=REQUIRED` : base;
}

/**
 * The public connection string. It uses the Platform Domain and the proxy's
 * unique port, and it requires TLS: the Database terminates TLS itself, so the
 * proxy can forward the stream without breaking libpq's SSLRequest negotiation.
 */
function buildPublicConnectionString(row: DatabaseRow, password: string, port: number): string {
  return `postgres://${encodeURIComponent(row.username)}:${encodeURIComponent(password)}@${getPlatformDomain()}:${port}/${encodeURIComponent(row.databaseName)}?sslmode=require`;
}

function toProxySummary(
  row: DatabaseRow,
  proxyRow: DatabaseProxyRow | null,
  includeConnectionString: boolean,
): DatabaseProxySummary {
  if (!proxyRow) {
    return { enabled: false, port: null, allowlist: [], connectionString: null };
  }

  return {
    enabled: true,
    port: proxyRow.port,
    allowlist: proxyRow.allowlist,
    connectionString: includeConnectionString
      ? buildPublicConnectionString(row, decryptPassword(row), proxyRow.port)
      : null,
  };
}

/**
 * Validates the allowlist before it reaches the Node Agent. Bare IPs are
 * accepted; the agent canonicalizes them to /32 or /128 and masks a non-network
 * IPv4 address, then its response is what the Control Plane stores.
 */
export function normalizeProxyAllowlist(value: unknown): string[] {
  const raw = typeof value === "string" ? value.split(/[\n,]+/) : value;
  if (!Array.isArray(raw)) {
    throw new ApiError(
      400,
      "invalid_allowlist",
      "At least one allowlist CIDR is required to enable the public proxy.",
    );
  }

  const entries = raw
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    throw new ApiError(
      400,
      "invalid_allowlist",
      "At least one allowlist CIDR is required to enable the public proxy.",
    );
  }
  if (entries.length > MAX_DATABASE_PROXY_ALLOWLIST) {
    throw new ApiError(
      400,
      "invalid_allowlist",
      `At most ${MAX_DATABASE_PROXY_ALLOWLIST} allowlist entries are allowed.`,
    );
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of entries) {
    const cidr = normalizeCidr(entry);
    if (!seen.has(cidr)) {
      seen.add(cidr);
      normalized.push(cidr);
    }
  }

  return normalized;
}

function normalizeCidr(value: string): string {
  if (/[\s;]/.test(value)) {
    throw invalidCidr(value);
  }

  const slash = value.indexOf("/");
  if (slash === -1) {
    if (isIP(value) === 0) {
      throw invalidCidr(value);
    }
    return value;
  }

  const address = value.slice(0, slash);
  const prefix = value.slice(slash + 1);
  const family = isIP(address);
  if (family === 0 || !/^\d+$/.test(prefix)) {
    throw invalidCidr(value);
  }

  const prefixNumber = Number(prefix);
  if ((family === 4 && prefixNumber > 32) || (family === 6 && prefixNumber > 128)) {
    throw invalidCidr(value);
  }

  return `${address}/${prefixNumber}`;
}

function invalidCidr(value: string): ApiError {
  return new ApiError(
    400,
    "invalid_allowlist",
    `${JSON.stringify(value)} is not a valid IPv4 or IPv6 CIDR.`,
  );
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
    const state = await nodeAgent.readDatabase({
      databaseId: row.id,
      storageLimitMb: row.storageLimitMb,
    });

    // A Database the node does not have is not a node failure: it may not be
    // provisioned yet, or the node may have been rebuilt.
    if (!state) {
      return {
        status: "failed",
        healthy: false,
        usageMb: 0,
        overQuota: false,
        phpMyAdminReady: false,
      };
    }

    return {
      status: mapAgentStatus(state.status),
      healthy: state.healthy,
      usageMb: state.usageMb,
      overQuota: state.overQuota ?? false,
      phpMyAdminReady: state.phpMyAdminReady ?? false,
    };
  } catch (error) {
    console.error(`could not read the state of Database ${row.id}`, error);
  }

  return {
    status: row.status === "provisioning" ? "provisioning" : row.status,
    healthy: false,
    usageMb: null,
    overQuota: false,
    phpMyAdminReady: false,
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

function toPhpMyAdminSummary(
  row: DatabaseRow,
  measurement: Measurement,
): DatabasePhpMyAdminSummary {
  if (row.engine !== "mysql" || !row.phpMyAdminHostname) {
    return { enabled: false, url: null, hostname: null, ready: false };
  }

  return {
    enabled: true,
    url: `https://${row.phpMyAdminHostname}`,
    hostname: row.phpMyAdminHostname,
    ready: measurement.phpMyAdminReady,
  };
}

function toSummary(
  row: DatabaseRow,
  measurement: Measurement,
  includeConnectionString: boolean,
  proxyRow: DatabaseProxyRow | null = null,
): DatabaseSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    engine: row.engine,
    version: row.version,
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
    proxy: toProxySummary(row, proxyRow, includeConnectionString),
    phpMyAdmin: toPhpMyAdminSummary(row, measurement),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
  const needsRedeploy = await projectNeedsRedeploy(input.projectId);

  if (!row) {
    return { database: null, needsRedeploy };
  }

  const measurement = await measureDatabase(row);
  await persistStatus(row, measurement.status);
  const proxyRow = await loadProxyRow(row.id);

  return {
    database: toSummary(row, measurement, input.includeConnectionString, proxyRow),
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
    const proxyRow = await loadProxyRow(row.id);
    summaries.push({
      ...toSummary(row, measurement, includeConnectionString, proxyRow),
      projectName: row.projectName,
    });
  }

  return summaries;
}

/**
 * Provisions the Project's one Database. The password is generated here, sealed
 * before it is stored, and only ever sent to the Node Agent in the request body.
 * A failed provisioning removes the row so the user can try again.
 *
 * The engine is chosen once. A MySQL Database also receives a phpMyAdmin
 * hostname on the Platform Domain in the same transaction, so the dashboard
 * never shows a Database whose browser client has no address.
 */
export async function createProjectDatabase(input: {
  organizationId: string;
  projectId: string;
  engine?: unknown;
  storageLimitMb?: unknown;
}): Promise<DatabaseSummary> {
  const engine = normalizeEngine(input.engine);
  const version = DATABASE_ENGINES[engine];
  const storageLimitMb = normalizeStorageLimitMb(input.storageLimitMb);
  const project = await requireProject(input.organizationId, input.projectId);

  await assertQuota(pool, { type: "database", projectId: input.projectId });

  const password = randomBytes(32).toString("hex");
  const encryptedPassword = encryptSecret(password);

  const client = await pool.connect();
  let row: DatabaseRow;
  try {
    await client.query("BEGIN");
    // Serialize role allocation with the insert below. The cheap SELECT in
    // uniqueReadableRole is otherwise a check-then-act race between two
    // concurrent Database creations, which could give two tenants one user.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('database_username_alloc'))");

    // The id is generated here rather than by the database, because the schema
    // the Agent creates is derived from it.
    const id = randomUUID();
    const names = databaseObjectNames(id);
    // New Databases get a readable role so phpMyAdmin needs no lookup; the
    // schema keeps the derived shape because nobody is ever shown it.
    const role = await uniqueReadableRole(project.name);
    // Every MySQL Database signs in through the one node-wide phpMyAdmin, so the
    // address is the same for all of them and needs no per-row allocation.
    const phpMyAdminHostname = engine === "mysql" ? sharedPhpMyAdminHostname() : null;
    try {
      const result = await client.query<DatabaseRow>(
        `INSERT INTO "database" ("id", "projectId", "engine", "version", "databaseName",
           "username", "encryptedPassword", "storageLimitMb", "status", "phpMyAdminHostname")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'provisioning', $9)
         RETURNING ${DATABASE_COLUMNS}`,
        [
          id,
          input.projectId,
          engine,
          version,
          names.schema,
          role,
          encryptedPassword,
          storageLimitMb,
          phpMyAdminHostname,
        ],
      );
      row = result.rows[0];
    } catch (error) {
      const pgError = error as { code?: string; constraint?: string };
      if (pgError.code === "23505") {
        // The one Database per Project rule lives in `database_projectId_key`.
        // A `database_username_key` violation is the last-resort guard for the
        // username the advisory lock above is meant to keep unique.
        if (pgError.constraint === "database_username_key") {
          throw new ApiError(
            503,
            "database_username_conflict",
            "Database user name collision. Try again.",
          );
        }
        throw new QuotaExceededError(
          "Database",
          QUOTAS.databasesPerProject,
          QUOTAS.databasesPerProject,
          "Project",
        );
      }
      throw error;
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
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
    phpMyAdminReady: engine === "mysql",
  };

  return toSummary(row, measurement, true);
}

async function provisionDatabase(
  row: DatabaseRow,
  projectId: string,
  organizationId: string,
  password: string,
): Promise<DatabaseStatus> {
  const status = await nodeAgent.provisionDatabase({
    databaseId: row.id,
    projectId,
    organizationId,
    engine: row.engine,
    ...(row.phpMyAdminHostname ? { phpMyAdminHostname: row.phpMyAdminHostname } : {}),
    databaseName: row.databaseName,
    username: row.username,
    password,
    storageLimitMb: row.storageLimitMb,
  });

  return mapAgentStatus(status);
}

async function removeDatabaseOnNode(databaseId: string): Promise<void> {
  await nodeAgent.removeDatabase(databaseId);
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

  // The schema may already be gone on a node that was rebuilt; the row is the
  // only thing left to remove, so a missing Database is not a failure.
  await nodeAgent.removeDatabase(row.id);

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
  // A Database that is not running has no role to change yet, which is the
  // user's next step rather than a node failure; the module answers 409.
  await nodeAgent.rotateDatabasePassword({
    databaseId: row.id,
    engine: row.engine,
    password,
  });

  const encryptedPassword = encryptSecret(password);
  await pool.query('UPDATE "database" SET "encryptedPassword" = $2 WHERE "id" = $1', [
    row.id,
    encryptedPassword,
  ]);
  row.encryptedPassword = encryptedPassword;
  await bumpProjectRevisions(input.projectId);

  const measurement = await measureDatabase(row);

  return toSummary(row, measurement, true, await loadProxyRow(row.id));
}

/**
 * Returns the Database password for the dashboard's reveal button. It is the
 * same value the private connection string carries, so it is an owner/admin-only
 * read; the route records an AuditEvent and never logs the value.
 */
export async function revealProjectDatabasePassword(input: {
  organizationId: string;
  projectId: string;
}): Promise<{ password: string }> {
  await requireProject(input.organizationId, input.projectId);

  const row = await loadDatabaseRow(input.projectId);
  if (!row) {
    throw new ApiError(404, "database_not_found", "This Project has no Database.");
  }

  return { password: decryptPassword(row) };
}

/**
 * Every Database now lives in a shared engine server, so a public TCP proxy can
 * no longer isolate one tenant: one listener would forward to a single port that
 * serves every Database. The endpoint is refused for every engine instead of
 * silently publishing the whole server.
 */
function assertProxySupported(): never {
  throw new ApiError(
    409,
    "database_proxy_unsupported",
    "The public proxy is not available: a shared Database server cannot expose one Project without exposing the others. Reach the Database from a Service in the same Project, or use phpMyAdmin for MySQL.",
  );
}

/**
 * The public proxy is retired, so enabling it is refused for every Database. The
 * allowlist is still validated first, so a caller that sends a malformed one gets
 * the specific error rather than a generic refusal.
 */
export async function enableProjectDatabaseProxy(input: {
  organizationId: string;
  projectId: string;
  allowlist: unknown;
}): Promise<{ databaseId: string; proxy: DatabaseProxySummary }> {
  await requireProject(input.organizationId, input.projectId);

  const row = await loadDatabaseRow(input.projectId);
  if (!row) {
    throw new ApiError(404, "database_not_found", "This Project has no Database.");
  }
  normalizeProxyAllowlist(input.allowlist);

  // Always refuses: a shared server cannot publish one tenant, so this throws
  // instead of returning. Postgres has no browser client to fall back to.
  assertProxySupported();
}

/**
 * Disables the public proxy. The agent tears down a listener left over from the
 * per-Database model before the row is removed, so nothing is left open.
 */
export async function disableProjectDatabaseProxy(input: {
  organizationId: string;
  projectId: string;
}): Promise<{ databaseId: string; proxy: DatabaseProxySummary; changed: boolean }> {
  await requireProject(input.organizationId, input.projectId);

  const row = await loadDatabaseRow(input.projectId);
  if (!row) {
    throw new ApiError(404, "database_not_found", "This Project has no Database.");
  }

  const existing = await loadProxyRow(row.id);

  // A Database that never had a proxy listener has nothing to tear down.
  await nodeAgent.disableDatabaseProxy(row.id);

  await pool.query('DELETE FROM "database_proxy" WHERE "databaseId" = $1', [row.id]);

  return {
    databaseId: row.id,
    proxy: { enabled: false, port: null, allowlist: [], connectionString: null },
    changed: existing !== null,
  };
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
