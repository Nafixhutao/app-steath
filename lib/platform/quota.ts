import { ApiError } from "./api-error.ts";

/**
 * Quota limits from the platform spec. Kept free of server runtime dependencies so both
 * the API and the dashboard can read the same numbers.
 */
export const QUOTAS = {
  projectsPerOrganization: 3,
  servicesPerProject: 2,
  servicesPerOrganization: 5,
  databasesPerProject: 1,
  cpuPerService: 0.5,
  memoryMbPerService: 512,
  volumeMbPerService: 1024,
  databaseStorageMb: 1024,
  // Object storage follows the same free-tier shape as Databases: a small
  // number of Buckets per Project, each capped by MinIO's own bucket quota.
  bucketsPerProject: 3,
  bucketStorageMb: 1024,
  // The experiment runs one Build at a time per node, because the worker claims
  // one Build Job at a time.
  buildConcurrencyPerNode: 1,
  // Build and runtime logs are deleted after this many days.
  logRetentionDays: 7,
} as const;

/**
 * Raised when creating a resource would exceed a Quota. The API answers with
 * status 409 and names both the limit and the current usage.
 */
export class QuotaExceededError extends ApiError {
  constructor(resource: string, limit: number, usage: number, scope: string) {
    super(
      409,
      "quota_exceeded",
      `${resource} Quota reached: this ${scope} uses ${usage} of ${limit} allowed ${resource}s.`,
      { resource: resource.toLowerCase(), scope: scope.toLowerCase(), limit, usage },
    );
    this.name = "QuotaExceededError";
  }
}

type Queryable = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    queryText: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount?: number | null }>;
};

export type QuotaCheckScope =
  | { type: "project"; organizationId: string }
  | { type: "service"; organizationId: string; projectId: string }
  | { type: "database"; organizationId?: string; projectId: string }
  | { type: "bucket"; projectId: string };

/**
 * Asserts that creating a resource will not exceed Organization or Project Quotas.
 * Concentrates raw count queries, limits, and QuotaExceededError throwing in one deep module.
 */
export async function assertQuota(client: Queryable, scope: QuotaCheckScope): Promise<void> {
  if (scope.type === "project") {
    const res = await client.query<{ count: string }>(
      'SELECT count(*) FROM "project" WHERE "organizationId" = $1',
      [scope.organizationId],
    );
    const used = Number(res.rows[0]?.count ?? 0);
    const limit = QUOTAS.projectsPerOrganization;
    if (used >= limit) {
      throw new QuotaExceededError("Project", limit, used, "Organization");
    }
    return;
  }

  if (scope.type === "service") {
    const perProject = await client.query<{ count: string }>(
      'SELECT count(*) FROM "service" WHERE "projectId" = $1',
      [scope.projectId],
    );
    const projectUsage = Number(perProject.rows[0]?.count ?? 0);
    if (projectUsage >= QUOTAS.servicesPerProject) {
      throw new QuotaExceededError("Service", QUOTAS.servicesPerProject, projectUsage, "Project");
    }

    const perOrg = await client.query<{ count: string }>(
      `SELECT count(*) FROM "service" s
       JOIN "project" p ON p."id" = s."projectId"
       WHERE p."organizationId" = $1`,
      [scope.organizationId],
    );
    const orgUsage = Number(perOrg.rows[0]?.count ?? 0);
    if (orgUsage >= QUOTAS.servicesPerOrganization) {
      throw new QuotaExceededError(
        "Service",
        QUOTAS.servicesPerOrganization,
        orgUsage,
        "Organization",
      );
    }
    return;
  }

  if (scope.type === "database") {
    const res = await client.query<{ count: string }>(
      'SELECT count(*) FROM "database" WHERE "projectId" = $1',
      [scope.projectId],
    );
    const used = Number(res.rows[0]?.count ?? 0);
    const limit = QUOTAS.databasesPerProject;
    if (used >= limit) {
      throw new QuotaExceededError("Database", limit, used, "Project");
    }
    return;
  }

  if (scope.type === "bucket") {
    const res = await client.query<{ count: string }>(
      'SELECT count(*) FROM "storage_bucket" WHERE "projectId" = $1',
      [scope.projectId],
    );
    const used = Number(res.rows[0]?.count ?? 0);
    const limit = QUOTAS.bucketsPerProject;
    if (used >= limit) {
      throw new QuotaExceededError("Bucket", limit, used, "Project");
    }
    return;
  }
}
