import { pool } from "@/lib/platform/db";
import { apiData, apiError } from "@/lib/platform/api";
import { requirePlatformAdmin } from "@/lib/platform/platform-admin";

/**
 * Admin DB metrics — mirrors stealth-forge's `/v1/admin/db-metrics`: one
 * snapshot of PostgreSQL's own statistics plus the retained history inside the
 * window. Forge samples in-process every 5s with a 720-sample ring; paas keeps
 * the same sampler shape but reads PostgreSQL at request time and stores each
 * sample in `admin_db_metric`, so history survives restarts. A window is
 * capped at 24 hours to match the retention pass.
 */

const MAX_WINDOW_MINUTES = 24 * 60;
const CURRENT_WINDOW_MINUTES = 5;

type SampleRow = {
  timestamp: Date;
  connections: number;
  max_connections: number;
  active_queries: number;
  cache_hit_ratio_known: boolean;
  cache_hit_ratio_percent: number;
  transactions_per_sec: number;
  query_latency_ms: number;
  replication_standbys: number;
  database_size_bytes: number;
  uptime_seconds: number;
};

export async function GET(request: Request) {
  try {
    await requirePlatformAdmin(request.headers);

    const url = new URL(request.url);
    const rawWindow = url.searchParams.get("window_minutes");
    let windowMinutes = CURRENT_WINDOW_MINUTES;
    if (rawWindow !== null && rawWindow !== "") {
      windowMinutes = Number.parseInt(rawWindow, 10);
      if (!Number.isFinite(windowMinutes) || windowMinutes < 1) {
        windowMinutes = CURRENT_WINDOW_MINUTES;
      }
    }
    windowMinutes = Math.min(windowMinutes, MAX_WINDOW_MINUTES);

    const historyResult = await pool.query<SampleRow>(
      `
      SELECT "timestamp", "connections", "maxConnections" AS "max_connections",
             "activeQueries" AS "active_queries",
             "cacheHitRatioKnown" AS "cache_hit_ratio_known",
             "cacheHitRatioPercent"::float8 AS "cache_hit_ratio_percent",
             "transactionsPerSec"::float8 AS "transactions_per_sec",
             "queryLatencyMs"::float8 AS "query_latency_ms",
             "replicationStandbys" AS "replication_standbys",
             "databaseSizeBytes"::float8 AS "database_size_bytes",
             "uptimeSeconds"::float8 AS "uptime_seconds"
      FROM "admin_db_metric"
      WHERE "capturedAt" >= now() - ($1 || ' minutes')::interval
      ORDER BY "capturedAt" ASC
      `,
      [String(windowMinutes)],
    );

    const history: SampleRow[] = historyResult.rows;
    const current = history[history.length - 1];
    const reachable = current !== undefined;

    const versionResult = await pool.query<{ version: string }>("SELECT version() AS version");
    const serverVersion = reachable ? (versionResult.rows[0]?.version ?? "") : "";

    return apiData({
      current: current ?? null,
      history,
      server_version: serverVersion,
      reachable,
    });
  } catch (error) {
    return apiError(error);
  }
}
