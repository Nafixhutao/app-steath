import { pool } from "@/lib/platform/db";
import { apiData, apiError } from "@/lib/platform/api";
import { requirePlatformAdmin } from "@/lib/platform/platform-admin";

/**
 * Admin operations — mirrors stealth-forge's `/v1/admin/operations`: a bounded
 * list of durable control-plane work (deployments + jobs, newest first) in the
 * exact `AdminOperationsResponse` shape ({ items }). `range` selects the
 * window; `limit` caps the list. The execution-queue summary counts come from
 * the overview endpoint, exactly like the source read model wires it.
 */

const RANGES: Record<string, number> = {
  "1h": 60,
  "6h": 6 * 60,
  "24h": 24 * 60,
  "7d": 7 * 24 * 60,
};

export async function GET(request: Request) {
  try {
    await requirePlatformAdmin(request.headers);

    const url = new URL(request.url);
    // The Forge client sends an explicit from/to window; the range label is
    // the fallback when only that is present.
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const rawRange = url.searchParams.get("range") ?? "24h";
    const windowMinutes = RANGES[rawRange] ?? RANGES["24h"];
    const rawLimit = url.searchParams.get("limit");
    let limit = 100;
    if (rawLimit !== null && rawLimit !== "") {
      limit = Number.parseInt(rawLimit, 10);
      if (!Number.isFinite(limit) || limit < 1) limit = 100;
    }
    limit = Math.min(limit, 500);

    // The job table records claims, not run windows: `lockedAt` is when the
    // worker took the job, `updatedAt` its last transition, so terminal jobs
    // derive finished_at from updatedAt and running jobs stay open.
    const operationsResult = await pool.query<{
      id: string;
      kind: string;
      name: string;
      project_id: string | null;
      project_name: string | null;
      status: string;
      started_at: Date | null;
      finished_at: Date | null;
      duration_ms: number;
      error: string | null;
      created_at: Date;
    }>(`
      SELECT * FROM (
        SELECT
          d."id",
          'app_deployment' AS kind,
          'deploy ' || s."name" AS name,
          p."id" AS project_id,
          p."name" AS project_name,
          d."status",
          d."startedAt" AS started_at,
          d."finishedAt" AS finished_at,
          GREATEST(
            0,
            (EXTRACT(EPOCH FROM (COALESCE(d."finishedAt", now()) - d."startedAt")) * 1000)::bigint
          ) AS duration_ms,
          d."errorMessage" AS error,
          d."createdAt" AS created_at
        FROM "deployment" d
        JOIN "service" s ON s."id" = d."serviceId"
        JOIN "project" p ON p."id" = s."projectId"
        WHERE d."createdAt" >= ${from ? "$1::timestamptz" : "now() - ($1 || ' minutes')::interval"}
          ${to ? `AND d."createdAt" <= $2::timestamptz` : ""}
        UNION ALL
        SELECT
          j."id",
          j."type" AS kind,
          j."type" || ' ' || COALESCE(
            j."payload"->>'deploymentId',
            j."payload"->>'backupId',
            j."payload"->>'restoreId',
            j."id"
          ) AS name,
          NULL::text AS project_id,
          NULL::text AS project_name,
          j."status",
          j."lockedAt" AS started_at,
          CASE
            WHEN j."status" IN ('succeeded', 'failed', 'cancelled')
              THEN j."updatedAt"
          END AS finished_at,
          GREATEST(
            0,
            (EXTRACT(EPOCH FROM (
              CASE
                WHEN j."status" IN ('succeeded', 'failed', 'cancelled')
                  THEN j."updatedAt" - COALESCE(j."lockedAt", j."createdAt")
                ELSE now() - COALESCE(j."lockedAt", j."createdAt")
              END
            )) * 1000)::bigint
          ) AS duration_ms,
          j."lastError" AS error,
          j."createdAt" AS created_at
        FROM "job" j
        WHERE j."createdAt" >= ${from ? "$1::timestamptz" : "now() - ($1 || ' minutes')::interval"}
          ${to ? `AND j."createdAt" <= $2::timestamptz` : ""}
      ) operations
      ORDER BY "created_at" DESC
      LIMIT ${limit}
    `, to ? [from, to] : [from ?? String(windowMinutes)]);

    return apiData({
      items: operationsResult.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        ...(row.project_id ? { project_id: row.project_id } : {}),
        ...(row.project_name ? { project_name: row.project_name } : {}),
        status: row.status,
        ...(row.started_at ? { started_at: row.started_at.toISOString() } : {}),
        ...(row.finished_at
          ? { finished_at: row.finished_at.toISOString() }
          : {}),
        duration_ms: Number(row.duration_ms),
        ...(row.error ? { error: row.error } : {}),
        created_at: row.created_at.toISOString(),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
