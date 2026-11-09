import { Pool } from "pg";
import { ApiError } from "@/lib/platform/api";
import { QUOTAS, QuotaExceededError } from "@/lib/platform/quota";
import { MAX_SLUG_LENGTH, slugify } from "@/lib/slug";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 80;

export type ProjectSummary = {
  id: string;
  name: string;
  slug: string;
  serviceCount: number;
  databaseCount: number;
  status: "empty" | "active";
  createdAt: Date;
  updatedAt: Date;
};

type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  serviceCount: string | number;
  databaseCount: string | number;
  createdAt: Date;
  updatedAt: Date;
};

function normalizeName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "invalid_project_name", "A Project name is required.");
  }

  const name = value.trim();
  if (name.length > MAX_NAME_LENGTH) {
    throw new ApiError(
      400,
      "invalid_project_name",
      `A Project name must be at most ${MAX_NAME_LENGTH} characters.`,
    );
  }

  return name;
}

function normalizeSlug(value: unknown, fallbackName: string): string {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
    const generated = slugify(fallbackName);
    if (!generated) {
      throw new ApiError(
        400,
        "invalid_project_slug",
        "A Project slug is required and must contain letters or numbers.",
      );
    }
    return generated;
  }

  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_project_slug", "A Project slug must be a string.");
  }

  const slug = value.trim().toLowerCase();
  if (slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) {
    throw new ApiError(
      400,
      "invalid_project_slug",
      `A Project slug must be lowercase letters, numbers, and single hyphens, up to ${MAX_SLUG_LENGTH} characters.`,
    );
  }

  return slug;
}

/**
 * Resource counts per Project. The Service and Database counts are read from the
 * real tables so the Project summary never guesses.
 */
function summarize(row: ProjectRow): ProjectSummary {
  const serviceCount = Number(row.serviceCount ?? 0);
  const databaseCount = Number(row.databaseCount ?? 0);

  return {
    ...row,
    serviceCount,
    databaseCount,
    status: serviceCount + databaseCount === 0 ? "empty" : "active",
  };
}

const PROJECT_SELECT = `SELECT p."id", p."name", p."slug", p."createdAt", p."updatedAt",
  (SELECT count(*) FROM "service" s WHERE s."projectId" = p."id") AS "serviceCount",
  (SELECT count(*) FROM "database" d WHERE d."projectId" = p."id") AS "databaseCount"
  FROM "project" p`;

export async function listProjects(organizationId: string): Promise<ProjectSummary[]> {
  const result = await pool.query<ProjectRow>(
    `${PROJECT_SELECT} WHERE p."organizationId" = $1 ORDER BY p."createdAt", p."id"`,
    [organizationId],
  );

  return result.rows.map(summarize);
}

export async function getProject(
  organizationId: string,
  projectId: string,
): Promise<ProjectSummary> {
  const result = await pool.query<ProjectRow>(
    `${PROJECT_SELECT} WHERE p."organizationId" = $1 AND p."id" = $2`,
    [organizationId, projectId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "project_not_found", "Project not found.");
  }

  return summarize(row);
}

export async function createProject(input: {
  organizationId: string;
  name: unknown;
  slug: unknown;
}): Promise<ProjectSummary> {
  const name = normalizeName(input.name);
  const slug = normalizeSlug(input.slug, name);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize Project creation per Organization so two concurrent requests
    // cannot both observe a free slot and exceed the Quota.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `project-quota:${input.organizationId}`,
    ]);

    const usage = await client.query<{ count: string }>(
      'SELECT count(*) FROM "project" WHERE "organizationId" = $1',
      [input.organizationId],
    );
    const used = Number(usage.rows[0]?.count ?? 0);
    const limit = QUOTAS.projectsPerOrganization;
    if (used >= limit) {
      throw new QuotaExceededError("Project", limit, used, "Organization");
    }

    const existing = await client.query(
      'SELECT 1 FROM "project" WHERE "organizationId" = $1 AND "slug" = $2',
      [input.organizationId, slug],
    );
    if (existing.rowCount) {
      throw new ApiError(
        409,
        "project_slug_taken",
        `This Organization already has a Project with the slug "${slug}".`,
      );
    }

    const inserted = await client.query<ProjectRow>(
      `INSERT INTO "project" ("id", "organizationId", "name", "slug")
       VALUES (gen_random_uuid()::text, $1, $2, $3)
       RETURNING "id", "name", "slug", 0 AS "serviceCount", 0 AS "databaseCount",
         "createdAt", "updatedAt"`,
      [input.organizationId, name, slug],
    );

    await client.query("COMMIT");
    return summarize(inserted.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateProject(input: {
  organizationId: string;
  projectId: string;
  name?: unknown;
  slug?: unknown;
}): Promise<ProjectSummary> {
  const current = await getProject(input.organizationId, input.projectId);
  const name = input.name === undefined ? current.name : normalizeName(input.name);
  const slug = input.slug === undefined ? current.slug : normalizeSlug(input.slug, name);

  if (slug !== current.slug) {
    const existing = await pool.query(
      'SELECT 1 FROM "project" WHERE "organizationId" = $1 AND "slug" = $2 AND "id" <> $3',
      [input.organizationId, slug, input.projectId],
    );
    if (existing.rowCount) {
      throw new ApiError(
        409,
        "project_slug_taken",
        `This Organization already has a Project with the slug "${slug}".`,
      );
    }
  }

  const result = await pool.query<ProjectRow>(
    `UPDATE "project" SET "name" = $1, "slug" = $2
     WHERE "organizationId" = $3 AND "id" = $4
     RETURNING "id", "name", "slug",
       (SELECT count(*) FROM "service" s WHERE s."projectId" = "project"."id") AS "serviceCount",
       (SELECT count(*) FROM "database" d WHERE d."projectId" = "project"."id") AS "databaseCount",
       "createdAt", "updatedAt"`,
    [name, slug, input.organizationId, input.projectId],
  );

  if (!result.rows[0]) {
    throw new ApiError(404, "project_not_found", "Project not found.");
  }

  return summarize(result.rows[0]);
}

/**
 * Deletes a Project after the caller types its name. Resources that belong to
 * the Project are removed by the foreign keys added in later migrations.
 */
export async function deleteProject(input: {
  organizationId: string;
  projectId: string;
  confirmation: unknown;
}): Promise<{ id: string; name: string; slug: string }> {
  if (typeof input.confirmation !== "string" || !input.confirmation.trim()) {
    throw new ApiError(400, "confirmation_required", "Project name confirmation is required.");
  }

  const current = await getProject(input.organizationId, input.projectId);
  if (input.confirmation.trim() !== current.name) {
    throw new ApiError(
      400,
      "confirmation_mismatch",
      "The confirmation text does not match the Project name.",
    );
  }

  await pool.query('DELETE FROM "project" WHERE "organizationId" = $1 AND "id" = $2', [
    input.organizationId,
    input.projectId,
  ]);

  return { id: current.id, name: current.name, slug: current.slug };
}
