import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { ApiError } from "@/lib/platform/api";
import { buildPlatformHostname } from "@/lib/platform/platform-domain";
import { QUOTAS, QuotaExceededError } from "@/lib/platform/quota";
import { MAX_SLUG_LENGTH, slugify } from "@/lib/slug";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MAX_NAME_LENGTH = 80;
const MAX_BRANCH_LENGTH = 120;
const MAX_PATH_LENGTH = 200;
const DEFAULT_BRANCH = "main";
const DEFAULT_DOCKERFILE_PATH = "Dockerfile";
const DEFAULT_CONTAINER_PORT = 3000;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const DOCKERFILE_PATTERN = /^[A-Za-z0-9._/-]+$/;
const HOSTNAME_SHORT_ID_LENGTH = 6;
const HOSTNAME_ATTEMPTS = 5;

export type ServiceStatus =
  "not_deployed" | "deploying" | "running" | "stopped" | "failed" | "suspended";

export type ServiceSummary = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  repoUrl: string;
  branch: string;
  dockerfilePath: string;
  containerPort: number;
  healthPath: string | null;
  status: ServiceStatus;
  platformHostname: string;
  url: string;
  cpuLimit: number;
  memoryLimitMb: number;
  createdAt: Date;
  updatedAt: Date;
};

type ServiceRow = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  repoUrl: string;
  branch: string;
  dockerfilePath: string;
  containerPort: number;
  healthPath: string | null;
  status: ServiceStatus;
  platformHostname: string;
  cpuLimit: string | number;
  memoryLimitMb: number;
  createdAt: Date;
  updatedAt: Date;
};

const SERVICE_FIELDS = [
  "id",
  "projectId",
  "name",
  "slug",
  "repoUrl",
  "branch",
  "dockerfilePath",
  "containerPort",
  "healthPath",
  "status",
  "platformHostname",
  "cpuLimit",
  "memoryLimitMb",
  "createdAt",
  "updatedAt",
] as const;

const SERVICE_COLUMNS = SERVICE_FIELDS.map((field) => `"${field}"`).join(", ");
const PREFIXED_SERVICE_COLUMNS = SERVICE_FIELDS.map((field) => `s."${field}"`).join(", ");

/**
 * Public URL of a Service. Platform Subdomains are served over HTTPS in every
 * environment except local development, where the host has no certificate.
 */
function serviceUrl(hostname: string): string {
  const protocol = hostname.endsWith(".localhost") || hostname === "localhost" ? "http" : "https";
  return `${protocol}://${hostname}`;
}

function toSummary(row: ServiceRow): ServiceSummary {
  return {
    ...row,
    cpuLimit: Number(row.cpuLimit),
    url: serviceUrl(row.platformHostname),
  };
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "invalid_service_name", "A Service name is required.");
  }

  const name = value.trim();
  if (name.length > MAX_NAME_LENGTH) {
    throw new ApiError(
      400,
      "invalid_service_name",
      `A Service name must be at most ${MAX_NAME_LENGTH} characters.`,
    );
  }

  return name;
}

/**
 * Accepts only public HTTPS repository URLs. Credentials, other protocols, and
 * local hosts are rejected because the Node Agent clones without auth.
 */
function normalizeRepoUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "invalid_repo_url", "A repository URL is required.");
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ApiError(400, "invalid_repo_url", "The repository URL is not a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new ApiError(400, "invalid_repo_url", "The repository URL must use HTTPS.");
  }

  if (url.username || url.password) {
    throw new ApiError(400, "invalid_repo_url", "The repository URL must not contain credentials.");
  }

  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1"
  ) {
    throw new ApiError(400, "invalid_repo_url", "The repository URL must point at a public host.");
  }

  if (url.search || url.hash) {
    throw new ApiError(
      400,
      "invalid_repo_url",
      "The repository URL must not contain a query or fragment.",
    );
  }

  return url.toString();
}

function normalizeBranch(value: unknown): string {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
    return DEFAULT_BRANCH;
  }

  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_branch", "A branch must be a string.");
  }

  const branch = value.trim();
  if (
    branch.length > MAX_BRANCH_LENGTH ||
    !BRANCH_PATTERN.test(branch) ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.includes("..") ||
    branch.endsWith(".lock") ||
    branch.includes("//")
  ) {
    throw new ApiError(
      400,
      "invalid_branch",
      "A branch may only contain letters, numbers, dots, dashes, underscores, and slashes.",
    );
  }

  return branch;
}

function normalizeDockerfilePath(value: unknown): string {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
    return DEFAULT_DOCKERFILE_PATH;
  }

  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_dockerfile_path", "A Dockerfile path must be a string.");
  }

  const path = value.trim();
  if (
    path.length > MAX_PATH_LENGTH ||
    path.startsWith("/") ||
    !DOCKERFILE_PATTERN.test(path) ||
    path.split("/").includes("..")
  ) {
    throw new ApiError(
      400,
      "invalid_dockerfile_path",
      "A Dockerfile path must be relative and may only contain letters, numbers, dots, dashes, underscores, and slashes.",
    );
  }

  return path;
}

function normalizeContainerPort(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_CONTAINER_PORT;
  }

  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ApiError(
      400,
      "invalid_container_port",
      "A container port must be a whole number between 1 and 65535.",
    );
  }

  return port;
}

function normalizeHealthPath(value: unknown): string | null {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
    return null;
  }

  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_health_path", "A health path must be a string.");
  }

  const path = value.trim();
  if (path.length > MAX_PATH_LENGTH || !path.startsWith("/") || /\s/.test(path)) {
    throw new ApiError(
      400,
      "invalid_health_path",
      "A health path must start with / and must not contain spaces.",
    );
  }

  return path;
}

function normalizeSlug(name: string): string {
  const slug = slugify(name);
  if (!slug) {
    throw new ApiError(
      400,
      "invalid_service_name",
      "A Service name must contain letters or numbers to form its slug.",
    );
  }

  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
}

function randomShortId(): string {
  return randomBytes(HOSTNAME_SHORT_ID_LENGTH)
    .toString("base64url")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, HOSTNAME_SHORT_ID_LENGTH)
    .padEnd(HOSTNAME_SHORT_ID_LENGTH, "0");
}

/**
 * Confirms the Project belongs to the Organization, so a Service can never be
 * created in or read from another tenant.
 */
async function requireProject(organizationId: string, projectId: string): Promise<void> {
  const result = await pool.query(
    'SELECT 1 FROM "project" WHERE "organizationId" = $1 AND "id" = $2',
    [organizationId, projectId],
  );

  if (!result.rowCount) {
    throw new ApiError(404, "project_not_found", "Project not found.");
  }
}

export async function listServices(
  organizationId: string,
  projectId: string,
): Promise<ServiceSummary[]> {
  await requireProject(organizationId, projectId);

  const result = await pool.query<ServiceRow>(
    `SELECT ${SERVICE_COLUMNS} FROM "service"
     WHERE "projectId" = $1 ORDER BY "createdAt", "id"`,
    [projectId],
  );

  return result.rows.map(toSummary);
}

export type OrganizationServiceSummary = ServiceSummary & { projectName: string };

/**
 * Lists every Service in an Organization for the Services page. Each row also
 * carries its Project name so the dashboard can group and link them.
 */
export async function listOrganizationServices(
  organizationId: string,
): Promise<OrganizationServiceSummary[]> {
  const result = await pool.query<ServiceRow & { projectName: string }>(
    `SELECT ${PREFIXED_SERVICE_COLUMNS}, p."name" AS "projectName"
     FROM "service" s JOIN "project" p ON p."id" = s."projectId"
     WHERE p."organizationId" = $1
     ORDER BY p."createdAt", s."createdAt", s."id"`,
    [organizationId],
  );

  return result.rows.map((row) => ({ ...toSummary(row), projectName: row.projectName }));
}

export async function getService(
  organizationId: string,
  serviceId: string,
): Promise<ServiceSummary> {
  const result = await pool.query<ServiceRow>(
    `SELECT ${PREFIXED_SERVICE_COLUMNS}
     FROM "service" s JOIN "project" p ON p."id" = s."projectId"
     WHERE p."organizationId" = $1 AND s."id" = $2`,
    [organizationId, serviceId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "service_not_found", "Service not found.");
  }

  return toSummary(row);
}

export async function createService(input: {
  organizationId: string;
  projectId: string;
  name: unknown;
  repoUrl: unknown;
  branch: unknown;
  dockerfilePath: unknown;
  containerPort: unknown;
  healthPath: unknown;
}): Promise<ServiceSummary> {
  const name = normalizeName(input.name);
  const slug = normalizeSlug(name);
  const repoUrl = normalizeRepoUrl(input.repoUrl);
  const branch = normalizeBranch(input.branch);
  const dockerfilePath = normalizeDockerfilePath(input.dockerfilePath);
  const containerPort = normalizeContainerPort(input.containerPort);
  const healthPath = normalizeHealthPath(input.healthPath);

  await requireProject(input.organizationId, input.projectId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize Service creation per Organization so concurrent requests cannot
    // both observe a free slot and exceed either Quota.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `service-quota:${input.organizationId}`,
    ]);

    const perProject = await client.query<{ count: string }>(
      'SELECT count(*) FROM "service" WHERE "projectId" = $1',
      [input.projectId],
    );
    const projectUsage = Number(perProject.rows[0]?.count ?? 0);
    if (projectUsage >= QUOTAS.servicesPerProject) {
      throw new QuotaExceededError("Service", QUOTAS.servicesPerProject, projectUsage, "Project");
    }

    const perOrganization = await client.query<{ count: string }>(
      `SELECT count(*) FROM "service" s
       JOIN "project" p ON p."id" = s."projectId"
       WHERE p."organizationId" = $1`,
      [input.organizationId],
    );
    const organizationUsage = Number(perOrganization.rows[0]?.count ?? 0);
    if (organizationUsage >= QUOTAS.servicesPerOrganization) {
      throw new QuotaExceededError(
        "Service",
        QUOTAS.servicesPerOrganization,
        organizationUsage,
        "Organization",
      );
    }

    let inserted: ServiceRow | undefined;
    for (let attempt = 0; attempt < HOSTNAME_ATTEMPTS && !inserted; attempt += 1) {
      const platformHostname = buildPlatformHostname(slug, randomShortId());
      try {
        const result = await client.query<ServiceRow>(
          `INSERT INTO "service" ("id", "projectId", "name", "slug", "repoUrl", "branch",
             "dockerfilePath", "containerPort", "healthPath", "platformHostname")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING ${SERVICE_COLUMNS}`,
          [
            input.projectId,
            name,
            slug,
            repoUrl,
            branch,
            dockerfilePath,
            containerPort,
            healthPath,
            platformHostname,
          ],
        );
        inserted = result.rows[0];
      } catch (error) {
        // A hostname collision is retried with a new short id; anything else is
        // a real failure and must roll back.
        if ((error as { constraint?: string }).constraint === "service_platform_hostname_key") {
          continue;
        }
        throw error;
      }
    }

    if (!inserted) {
      throw new ApiError(
        500,
        "hostname_generation_failed",
        "A Platform Subdomain could not be generated for this Service.",
      );
    }

    await client.query("COMMIT");
    return toSummary(inserted);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Deletes a Service after the caller types its name. Deployment, Volume,
 * Environment Variable, and Custom Domain rows are removed by the foreign keys
 * added in later migrations.
 */
export async function deleteService(input: {
  organizationId: string;
  serviceId: string;
  confirmation: unknown;
}): Promise<{ id: string; name: string; slug: string; projectId: string }> {
  if (typeof input.confirmation !== "string" || !input.confirmation.trim()) {
    throw new ApiError(400, "confirmation_required", "Service name confirmation is required.");
  }

  const current = await getService(input.organizationId, input.serviceId);
  if (input.confirmation.trim() !== current.name) {
    throw new ApiError(
      400,
      "confirmation_mismatch",
      "The confirmation text does not match the Service name.",
    );
  }

  await pool.query('DELETE FROM "service" WHERE "id" = $1', [input.serviceId]);

  return {
    id: current.id,
    name: current.name,
    slug: current.slug,
    projectId: current.projectId,
  };
}
