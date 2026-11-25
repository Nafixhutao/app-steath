import { pool } from "./db.ts";
import { ApiError } from "./api-error.ts";

/**
 * The Service columns a caller needs once ownership is proven: enough to act on
 * the row (runtime, routing) and enough to prove a caller may act at all. Every
 * module resolves a Service through this one query, so the ownership join is
 * never re-derived and never drifts.
 */
export type ServiceAccessRow = {
  id: string;
  projectId: string;
  name: string;
  status: string;
  platformHostname: string;
  containerPort: number;
};

export type ProjectAccessRow = {
  id: string;
  name: string;
  slug: string;
};

/**
 * Loads the Service and confirms it is visible to the caller's Organization
 * before any read or write, so a Service id from another Organization always
 * answers 404. Callers that only need the check ignore the row.
 */
export async function requireService(
  organizationId: string,
  serviceId: string,
): Promise<ServiceAccessRow> {
  const result = await pool.query<ServiceAccessRow>(
    `SELECT s."id", s."projectId", s."name", s."status", s."platformHostname",
            s."containerPort"
     FROM "service" s JOIN "project" p ON p."id" = s."projectId"
     WHERE p."organizationId" = $1 AND s."id" = $2`,
    [organizationId, serviceId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "service_not_found", "Service not found.");
  }

  return row;
}

/**
 * Loads the Project and confirms it belongs to the Organization, so nothing can
 * be created in or read from another Organization. Callers that only need the
 * check ignore the row.
 */
export async function requireProject(
  organizationId: string,
  projectId: string,
): Promise<ProjectAccessRow> {
  const result = await pool.query<ProjectAccessRow>(
    'SELECT "id", "name", "slug" FROM "project" WHERE "organizationId" = $1 AND "id" = $2',
    [organizationId, projectId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "project_not_found", "Project not found.");
  }

  return row;
}
