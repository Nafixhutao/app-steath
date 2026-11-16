import { pool } from "@/lib/platform/db";
import { apiData, withAdmin } from "@/lib/platform/api";

/**
 * Admin Overview — mirrors stealth-forge's `/v1/admin/overview` payload shape:
 * component health (api/postgres/redis/agent), platform operation counts, and
 * the newest deployments across all projects. The optional HTTP block stays
 * absent because paas does not record request telemetry.
 */

/** Recent deployments, newest first, capped like the source query. */
const RECENT_DEPLOYMENTS_LIMIT = 8;

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const healthResult = await pool.query<{
      db_ok: boolean;
      node_id: string | null;
      node_name: string | null;
      node_status: string | null;
      node_last_seen: Date | null;
    }>(`
  SELECT
    (SELECT to_regclass('public."user"') IS NOT NULL) AS db_ok,
    n."id" AS node_id, n."name" AS node_name,
    n."status" AS node_status, n."lastSeenAt" AS node_last_seen
  FROM (SELECT 1) one
  LEFT JOIN "node" n ON n."id" = (SELECT "id" FROM "node" ORDER BY "createdAt" LIMIT 1)
`);

    const health = healthResult.rows[0];
    const nodeStale =
      !health.node_last_seen || Date.now() - new Date(health.node_last_seen).getTime() > 120_000;

    const components: { name: string; status: string }[] = [
      { name: "api", status: "healthy" },
      {
        name: "postgres",
        status: health.db_ok ? "healthy" : "unavailable",
      },
      // Redis is not part of the production stack yet; the panel renders the
      // honest unavailable state instead of inventing a status.
      { name: "redis", status: "unavailable" },
      {
        name: "agent",
        status:
          health.node_status === "healthy" && !nodeStale
            ? "healthy"
            : health.node_status === "unhealthy" || nodeStale
              ? "unavailable"
              : // The Forge component-status vocabulary has no "degraded";
                // an unseen-but-fresh node reports unknown.
                "unknown",
      },
    ];

    const operationsResult = await pool.query<{
      counts: {
        active_deployments: number;
        queued_jobs: number;
        running_jobs: number;
        failed_jobs: number;
      };
    }>(`
  SELECT jsonb_build_object(
    'active_deployments', (
      SELECT count(*) FROM "deployment" d
      WHERE d."status" IN ('queued', 'building', 'deploying')
    ),
    'queued_jobs', (SELECT count(*) FROM "job" j WHERE j."status" = 'queued'),
    'running_jobs', (SELECT count(*) FROM "job" j WHERE j."status" = 'running'),
    'failed_jobs', (SELECT count(*) FROM "job" j WHERE j."status" = 'failed')
  ) AS counts
`);

    const deploymentsResult = await pool.query<{
      id: string;
      app_name: string;
      version: number;
      status: string;
      build_status: string;
      created_at: Date;
    }>(`
  SELECT d."id",
         s."name" AS app_name,
         (row_number() OVER (PARTITION BY d."serviceId" ORDER BY d."createdAt"))::int AS version,
         d."status",
         CASE WHEN d."imageRef" IS NOT NULL THEN 'succeeded' ELSE 'pending' END AS build_status,
         d."createdAt" AS created_at
  FROM "deployment" d
  JOIN "service" s ON s."id" = d."serviceId"
  ORDER BY d."createdAt" DESC
  LIMIT ${RECENT_DEPLOYMENTS_LIMIT}
`);

    return apiData({
      instance_status: components.every((c) => c.status === "healthy") ? "healthy" : "degraded",
      checked_at: new Date().toISOString(),
      components,
      telemetry: { status: "unavailable" },
      operations: operationsResult.rows[0].counts,
      recent_deployments: deploymentsResult.rows.map((row) => ({
        id: row.id,
        app_name: row.app_name,
        version: row.version,
        status: row.status,
        build_status: row.build_status,
        created_at: row.created_at.toISOString(),
      })),
    });
  });
}
