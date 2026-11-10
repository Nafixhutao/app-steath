import { Pool } from "pg";
import { ApiError } from "@/lib/platform/api";
import { createAgentClient } from "@/lib/agent-client";
import { nodeConfig } from "@/lib/platform/nodes";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function setNodeSuspension(serviceId: string, suspended: boolean, restore = false) {
  const config = nodeConfig();
  const client = createAgentClient(config.baseUrl, config.token);
  const response = suspended
    ? await client.POST("/v1/services/{serviceId}/suspend", { params: { path: { serviceId } } })
    : await client.POST("/v1/services/{serviceId}/unsuspend", {
        params: { path: { serviceId } },
        body: { restore },
      });
  if (!response.response.ok && response.response.status !== 404) {
    throw new ApiError(
      502,
      "agent_unavailable",
      `The Node Agent could not ${suspended ? "suspend" : "restore"} the Service.`,
    );
  }
}

export async function listAdminResources(query: string) {
  const result = await pool.query(
    `SELECT o."id" AS "organizationId", o."name" AS "organizationName", o."slug" AS "organizationSlug",o."suspendedAt",
      s."id" AS "serviceId", s."name" AS "serviceName",s."platformHostname",s."status"
    FROM "organization" o LEFT JOIN "project" p ON p."organizationId"=o."id" LEFT JOIN "service" s ON s."projectId"=p."id"
    WHERE o."name" ILIKE $1 OR o."slug" ILIKE $1 OR s."name" ILIKE $1 OR s."platformHostname" ILIKE $1
    ORDER BY o."name",s."name" LIMIT 100`,
    [`%${query}%`],
  );
  return result.rows;
}

export async function suspendService(serviceId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ status: string }>(
      `SELECT s."status",s."organizationSuspended" FROM "service" s WHERE s."id"=$1 FOR UPDATE`,
      [serviceId],
    );
    if (!result.rowCount) throw new ApiError(404, "service_not_found", "Service not found.");
    if (result.rows[0].status !== "suspended") {
      await client.query(
        `UPDATE "service" SET "suspendedFromStatus"="status","status"='suspended' WHERE "id"=$1`,
        [serviceId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await setNodeSuspension(serviceId, true);
}

export async function unsuspendService(serviceId: string, organizationOverride = false) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ previous: string | null }>(
      `SELECT "suspendedFromStatus" AS previous FROM "service" WHERE "id"=$1 FOR UPDATE`,
      [serviceId],
    );
    if (!result.rowCount) throw new ApiError(404, "service_not_found", "Service not found.");
    const previous = result.rows[0].previous;
    if (previous === null)
      throw new ApiError(409, "service_not_suspended", "Service is not suspended.");
    const organization = await pool.query<{ suspended: boolean }>(
      `SELECT o."suspendedAt" IS NOT NULL AS suspended FROM "organization" o JOIN "project" p ON p."organizationId"=o."id" JOIN "service" s ON s."projectId"=p."id" WHERE s."id"=$1`,
      [serviceId],
    );
    if (!organizationOverride && organization.rows[0]?.suspended)
      throw new ApiError(
        409,
        "organization_suspended",
        "Unsuspend the Organization before restoring this Service.",
      );
    await client.query("COMMIT");
    await setNodeSuspension(serviceId, false, previous === "running");
    await pool.query(
      `UPDATE "service" SET "status"=$2,"suspendedFromStatus"=NULL,"organizationSuspended"=false WHERE "id"=$1`,
      [serviceId, previous],
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function suspendOrganization(organizationId: string) {
  const organization = await pool.query(
    `UPDATE "organization" SET "suspendedAt"=COALESCE("suspendedAt",now()) WHERE "id"=$1 RETURNING "id"`,
    [organizationId],
  );
  if (!organization.rowCount)
    throw new ApiError(404, "organization_not_found", "Organization not found.");
  const services = await pool.query<{
    id: string;
    status: string;
    organizationSuspended: boolean;
  }>(
    `SELECT s."id",s."status",s."organizationSuspended" FROM "service" s JOIN "project" p ON p."id"=s."projectId" WHERE p."organizationId"=$1`,
    [organizationId],
  );
  for (const service of services.rows) {
    if (service.status === "suspended") {
      // A Service suspended on its own keeps its own ownership and stays
      // suspended when the Organization is restored. A Service already owned
      // by this Organization means a previous attempt stopped after the row
      // was suspended but before the Agent installed the 503, so re-issue the
      // idempotent route on retry.
      if (service.organizationSuspended) await setNodeSuspension(service.id, true);
      continue;
    }
    await pool.query(`UPDATE "service" SET "organizationSuspended"=true WHERE "id"=$1`, [
      service.id,
    ]);
    await suspendService(service.id);
  }
}

export async function unsuspendOrganization(organizationId: string) {
  const result = await pool.query<{ id: string; suspendedAt: Date | null }>(
    `SELECT "id","suspendedAt" FROM "organization" WHERE "id"=$1`,
    [organizationId],
  );
  if (!result.rowCount)
    throw new ApiError(404, "organization_not_found", "Organization not found.");
  if (!result.rows[0].suspendedAt)
    throw new ApiError(409, "organization_not_suspended", "Organization is not suspended.");
  const services = await pool.query<{ id: string }>(
    `SELECT s."id" FROM "service" s JOIN "project" p ON p."id"=s."projectId" WHERE p."organizationId"=$1 AND s."suspendedFromStatus" IS NOT NULL AND s."organizationSuspended"=true`,
    [organizationId],
  );
  // Restore every Service first. Keep the Organization suspended if the Agent
  // fails partway through so a retry can safely continue without exposing an
  // incompletely restored tenant.
  for (const service of services.rows) {
    await unsuspendService(service.id, true);
  }
  await pool.query(`UPDATE "organization" SET "suspendedAt"=NULL WHERE "id"=$1`, [organizationId]);
}
