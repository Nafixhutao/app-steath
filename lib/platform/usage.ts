import { pool } from "./db.ts";
import { ApiError } from "./api-error.ts";
import { nodeAgent } from "./node-agent.ts";
import { QUOTAS } from "./quota-limits.ts";

/**
 * Organization Quota and usage. The API enforces the count Quotas when a
 * resource is created; this module records what the node actually measures so
 * the dashboard can show usage next to each limit. A measurement is stored as a
 * UsageSnapshot batch: one row per Service and one per Database, all sharing a
 * `capturedAt`, which is what makes "the latest batch" cheap to read.
 */

/** How long snapshot history is kept. The dashboard only reads the newest batch. */
const SNAPSHOT_RETENTION_DAYS = 7;

export type QuotaCount = { used: number; limit: number };

export type UsageTotals = {
  cpu: number;
  memoryMb: number;
  volumeMb: number;
  databaseMb: number;
};

export type ServiceUsageSummary = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  status: string;
  cpuUsage: number;
  cpuLimit: number;
  memoryUsageMb: number;
  memoryLimitMb: number;
  volumeUsageMb: number;
  volumeLimitMb: number;
};

export type DatabaseUsageSummary = {
  id: string;
  projectId: string;
  projectName: string;
  engine: string;
  version: string;
  status: string;
  usageMb: number;
  storageLimitMb: number;
  overQuota: boolean;
};

export type ProjectUsageSummary = {
  id: string;
  name: string;
  serviceCount: number;
  serviceLimit: number;
  databaseCount: number;
  databaseLimit: number;
};

export type OrganizationUsage = {
  capturedAt: string | null;
  limits: {
    projectsPerOrganization: number;
    servicesPerProject: number;
    servicesPerOrganization: number;
    databasesPerProject: number;
    cpuPerService: number;
    memoryMbPerService: number;
    volumeMbPerService: number;
    databaseStorageMb: number;
    buildConcurrencyPerNode: number;
    logRetentionDays: number;
  };
  counts: {
    projects: QuotaCount;
    services: QuotaCount;
    databases: { used: number };
  };
  totals: UsageTotals;
  projects: ProjectUsageSummary[];
  services: ServiceUsageSummary[];
  databases: DatabaseUsageSummary[];
};

type ServiceRow = {
  id: string;
  name: string;
  status: string;
  projectId: string;
  projectName: string;
  volumeSizeMb: number | null;
};

type DatabaseRow = {
  id: string;
  databaseName: string;
  projectId: string;
  projectName: string;
  engine: string;
  version: string;
  status: string;
  storageLimitMb: number;
};

type ProjectRow = {
  id: string;
  name: string;
  serviceCount: number;
  databaseCount: number;
};

type SnapshotRow = {
  serviceId: string | null;
  databaseId: string | null;
  cpuUsage: string | number;
  memoryUsageMb: number;
  volumeUsageMb: number;
  databaseUsageMb: number;
  capturedAt: Date;
};

type AgentUsage = {
  services: Array<{
    serviceId: string;
    cpuUsage: number;
    memoryUsageMb: number;
    volumeUsageMb: number;
  }>;
  databases: Array<{ databaseName: string; usageMb: number }>;
};

async function loadServiceRows(organizationId: string): Promise<ServiceRow[]> {
  const result = await pool.query<ServiceRow>(
    `SELECT s."id", s."name", s."status", s."projectId", p."name" AS "projectName",
            v."sizeMb" AS "volumeSizeMb"
     FROM "service" s
     JOIN "project" p ON p."id" = s."projectId"
     LEFT JOIN "volume" v ON v."serviceId" = s."id"
     WHERE p."organizationId" = $1
     ORDER BY p."createdAt", s."createdAt", s."id"`,
    [organizationId],
  );

  return result.rows;
}

async function loadDatabaseRows(organizationId: string): Promise<DatabaseRow[]> {
  const result = await pool.query<DatabaseRow>(
    `SELECT d."id", d."databaseName", d."projectId", p."name" AS "projectName",
            d."status", d."storageLimitMb", d."engine", d."version"
     FROM "database" d
     JOIN "project" p ON p."id" = d."projectId"
     WHERE p."organizationId" = $1
     ORDER BY p."createdAt", d."createdAt", d."id"`,
    [organizationId],
  );

  return result.rows;
}

/**
 * Asks the Node Agent once for the whole node. A node that cannot be reached is
 * not an error for the dashboard: the previous snapshot stays visible.
 */
async function loadAgentUsage(): Promise<AgentUsage | null> {
  try {
    const usage = await nodeAgent.readUsage();

    return { services: usage.services, databases: usage.databases };
  } catch (error) {
    // A node that cannot be reached is not an error for the dashboard: the
    // previous snapshot stays visible. `nodeAgent` already logged the ApiError.
    if (!(error instanceof ApiError)) {
      console.error("could not read usage from the Node Agent", error);
    }
  }

  return null;
}

async function insertSnapshots(
  organizationId: string,
  services: ServiceRow[],
  databases: DatabaseRow[],
  usage: AgentUsage,
  capturedAt: Date,
): Promise<number> {
  const serviceUsage = new Map(usage.services.map((item) => [item.serviceId, item]));
  // A Database is a schema inside a shared server, so the Agent reports the
  // schema name it created and this map joins it to the stored row.
  const databaseUsage = new Map(usage.databases.map((item) => [item.databaseName, item]));

  const values: unknown[] = [];
  const rows: string[] = [];
  const push = (
    projectId: string,
    serviceId: string | null,
    databaseId: string | null,
    cpu: number,
    memoryMb: number,
    volumeMb: number,
    databaseMb: number,
  ) => {
    const base = values.length;
    values.push(
      organizationId,
      projectId,
      serviceId,
      databaseId,
      cpu,
      memoryMb,
      volumeMb,
      databaseMb,
      capturedAt,
    );
    rows.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`,
    );
  };

  for (const service of services) {
    const measured = serviceUsage.get(service.id);
    push(
      service.projectId,
      service.id,
      null,
      measured?.cpuUsage ?? 0,
      measured?.memoryUsageMb ?? 0,
      measured?.volumeUsageMb ?? 0,
      0,
    );
  }

  for (const database of databases) {
    const measured = databaseUsage.get(database.databaseName);
    push(database.projectId, null, database.id, 0, 0, 0, measured?.usageMb ?? 0);
  }

  if (rows.length === 0) {
    return 0;
  }

  await pool.query(
    `INSERT INTO "usage_snapshot" ("organizationId", "projectId", "serviceId", "databaseId",
       "cpuUsage", "memoryUsageMb", "volumeUsageMb", "databaseUsageMb", "capturedAt")
     VALUES ${rows.join(", ")}`,
    values,
  );

  return rows.length;
}

/**
 * Measures the Organization's resources and stores one snapshot batch. Called
 * every five minutes by the worker and whenever the Quota page is opened.
 *
 * `measured` lets the worker reuse one Agent reading for every Organization:
 * the reading covers the whole node, and asking once per Organization would
 * make the pass take seconds each time it runs.
 */
export async function refreshOrganizationUsage(
  organizationId: string,
  measured?: AgentUsage | null,
): Promise<{ capturedAt: string | null; snapshots: number }> {
  const [services, databases] = await Promise.all([
    loadServiceRows(organizationId),
    loadDatabaseRows(organizationId),
  ]);

  if (services.length === 0 && databases.length === 0) {
    return { capturedAt: null, snapshots: 0 };
  }

  const usage = measured === undefined ? await loadAgentUsage() : measured;
  if (!usage) {
    return { capturedAt: null, snapshots: 0 };
  }

  const capturedAt = new Date();
  const snapshots = await insertSnapshots(organizationId, services, databases, usage, capturedAt);

  // Keep the table bounded; the dashboard only ever reads the newest batch.
  await pool.query(
    `DELETE FROM "usage_snapshot"
     WHERE "organizationId" = $1 AND "capturedAt" < now() - ($2 || ' days')::interval`,
    [organizationId, SNAPSHOT_RETENTION_DAYS],
  );

  return { capturedAt: capturedAt.toISOString(), snapshots };
}

/**
 * Refreshes every Organization that owns at least one Project. The worker calls
 * this on its five-minute timer.
 */
export async function refreshAllOrganizationsUsage(): Promise<{
  organizations: number;
  snapshots: number;
}> {
  const result = await pool.query<{ id: string }>(
    'SELECT DISTINCT "organizationId" AS "id" FROM "project" ORDER BY "organizationId"',
  );

  // One Agent reading serves every Organization, because the snapshot covers
  // the node rather than a single tenant. Fetching per Organization would make
  // the pass block the worker's Job loop for minutes.
  const usage = result.rows.length > 0 ? await loadAgentUsage() : null;

  let snapshots = 0;
  for (const row of result.rows) {
    const refreshed = await refreshOrganizationUsage(row.id, usage);
    snapshots += refreshed.snapshots;
  }

  return { organizations: result.rows.length, snapshots };
}

async function loadLatestSnapshots(organizationId: string): Promise<{
  capturedAt: Date | null;
  services: Map<string, SnapshotRow>;
  databases: Map<string, SnapshotRow>;
}> {
  const result = await pool.query<SnapshotRow>(
    `SELECT "serviceId", "databaseId", "cpuUsage", "memoryUsageMb", "volumeUsageMb",
            "databaseUsageMb", "capturedAt"
     FROM "usage_snapshot"
     WHERE "organizationId" = $1
       AND "capturedAt" = (
         SELECT max("capturedAt") FROM "usage_snapshot" WHERE "organizationId" = $1
       )`,
    [organizationId],
  );

  const services = new Map<string, SnapshotRow>();
  const databases = new Map<string, SnapshotRow>();
  for (const row of result.rows) {
    if (row.serviceId) {
      services.set(row.serviceId, row);
    }
    if (row.databaseId) {
      databases.set(row.databaseId, row);
    }
  }

  return {
    capturedAt: result.rows[0]?.capturedAt ?? null,
    services,
    databases,
  };
}

function numeric(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

/**
 * Reads the newest snapshot batch and combines it with the live resource counts.
 * Counts are always current, so a resource created since the last snapshot still
 * shows up; only the measured CPU, memory, and storage can be a few minutes old.
 */
export async function getOrganizationUsage(organizationId: string): Promise<OrganizationUsage> {
  const [projectsResult, services, databases, snapshots] = await Promise.all([
    pool.query<ProjectRow>(
      `SELECT p."id", p."name",
              (SELECT count(*)::int FROM "service" s WHERE s."projectId" = p."id") AS "serviceCount",
              (SELECT count(*)::int FROM "database" d WHERE d."projectId" = p."id") AS "databaseCount"
       FROM "project" p
       WHERE p."organizationId" = $1
       ORDER BY p."createdAt", p."id"`,
      [organizationId],
    ),
    loadServiceRows(organizationId),
    loadDatabaseRows(organizationId),
    loadLatestSnapshots(organizationId),
  ]);

  const projects: ProjectUsageSummary[] = projectsResult.rows.map((project) => ({
    id: project.id,
    name: project.name,
    serviceCount: project.serviceCount,
    serviceLimit: QUOTAS.servicesPerProject,
    databaseCount: project.databaseCount,
    databaseLimit: QUOTAS.databasesPerProject,
  }));

  let cpu = 0;
  let memoryMb = 0;
  let volumeMb = 0;
  let databaseMb = 0;

  const serviceSummaries: ServiceUsageSummary[] = services.map((service) => {
    const snapshot = snapshots.services.get(service.id);
    const serviceCpu = snapshot ? numeric(snapshot.cpuUsage) : 0;
    const serviceMemory = snapshot?.memoryUsageMb ?? 0;
    const serviceVolume = snapshot?.volumeUsageMb ?? 0;

    cpu += serviceCpu;
    memoryMb += serviceMemory;
    volumeMb += serviceVolume;

    return {
      id: service.id,
      name: service.name,
      projectId: service.projectId,
      projectName: service.projectName,
      status: service.status,
      cpuUsage: serviceCpu,
      cpuLimit: QUOTAS.cpuPerService,
      memoryUsageMb: serviceMemory,
      memoryLimitMb: QUOTAS.memoryMbPerService,
      volumeUsageMb: serviceVolume,
      volumeLimitMb: service.volumeSizeMb ?? QUOTAS.volumeMbPerService,
    };
  });

  const databaseSummaries: DatabaseUsageSummary[] = databases.map((database) => {
    const snapshot = snapshots.databases.get(database.id);
    const used = snapshot?.databaseUsageMb ?? 0;
    databaseMb += used;

    return {
      id: database.id,
      projectId: database.projectId,
      projectName: database.projectName,
      engine: database.engine,
      version: database.version,
      status: database.status,
      usageMb: used,
      storageLimitMb: database.storageLimitMb,
      overQuota: used > database.storageLimitMb,
    };
  });

  return {
    capturedAt: snapshots.capturedAt?.toISOString() ?? null,
    limits: {
      projectsPerOrganization: QUOTAS.projectsPerOrganization,
      servicesPerProject: QUOTAS.servicesPerProject,
      servicesPerOrganization: QUOTAS.servicesPerOrganization,
      databasesPerProject: QUOTAS.databasesPerProject,
      cpuPerService: QUOTAS.cpuPerService,
      memoryMbPerService: QUOTAS.memoryMbPerService,
      volumeMbPerService: QUOTAS.volumeMbPerService,
      databaseStorageMb: QUOTAS.databaseStorageMb,
      buildConcurrencyPerNode: QUOTAS.buildConcurrencyPerNode,
      logRetentionDays: QUOTAS.logRetentionDays,
    },
    counts: {
      projects: { used: projects.length, limit: QUOTAS.projectsPerOrganization },
      services: { used: serviceSummaries.length, limit: QUOTAS.servicesPerOrganization },
      databases: { used: databaseSummaries.length },
    },
    totals: { cpu, memoryMb, volumeMb, databaseMb },
    projects,
    services: serviceSummaries,
    databases: databaseSummaries,
  };
}
