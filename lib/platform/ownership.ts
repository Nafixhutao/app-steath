import { pool } from "./db.ts";
import { ApiError } from "./api-error.ts";

/**
 * Confirms the Service is visible to the caller's Organization before any read
 * or write, so a Service id from another Organization always answers 404.
 * Shared by every module that resolves a Service id from the caller.
 */
export async function requireService(organizationId: string, serviceId: string): Promise<void> {
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
 * Bumps the Service's configuration revision, which is what `needsRedeploy`
 * compares against the newest running Deployment. Shared by Volumes and
 * Environment Variables so one redeploy applies every pending change.
 */
export async function bumpRevision(serviceId: string): Promise<void> {
  await pool.query('UPDATE "service" SET "envRevision" = "envRevision" + 1 WHERE "id" = $1', [
    serviceId,
  ]);
}
