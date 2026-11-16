import { pool } from "@/lib/platform/db";
import { apiData, apiError } from "@/lib/platform/api";
import { requirePlatformAdmin } from "@/lib/platform/platform-admin";

/**
 * Admin Redis metrics — mirrors stealth-forge's `/v1/admin/redis-metrics`.
 * The production paas stack has no Redis service yet, so the sampler answers
 * `reachable: false` with empty history and the Overview panel renders its
 * honest unavailable state. When a Redis service is added (REDIS_URL), the
 * same endpoint reports its INFO numbers.
 */

const MAX_WINDOW_MINUTES = 24 * 60;

export async function GET(request: Request) {
  try {
    await requirePlatformAdmin(request.headers);

    const url = new URL(request.url);
    const rawWindow = url.searchParams.get("window_minutes");
    let windowMinutes = 5;
    if (rawWindow !== null && rawWindow !== "") {
      windowMinutes = Number.parseInt(rawWindow, 10);
      if (!Number.isFinite(windowMinutes) || windowMinutes < 1) {
        windowMinutes = 5;
      }
    }
    windowMinutes = Math.min(windowMinutes, MAX_WINDOW_MINUTES);

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      return apiData({
        current: null,
        history: [],
        server_version: "",
        reachable: false,
      });
    }

    const historyResult = await pool.query(
      `
      SELECT "timestamp", "connections", "maxClients" AS "max_clients",
             "opsPerSec"::float8 AS "ops_per_sec",
             "hitRateKnown" AS "hit_rate_known",
             "hitRatePercent"::float8 AS "hit_rate_percent",
             "memoryUsedBytes"::float8 AS "memory_used_bytes",
             "memoryMaxBytes"::float8 AS "memory_max_bytes",
             "keys", "uptimeSeconds"::float8 AS "uptime_seconds"
      FROM "admin_redis_metric"
      WHERE "capturedAt" >= now() - ($1 || ' minutes')::interval
      ORDER BY "capturedAt" ASC
      `,
      [String(windowMinutes)],
    );

    return apiData({
      current: historyResult.rows[historyResult.rows.length - 1] ?? null,
      history: historyResult.rows,
      server_version: "",
      reachable: historyResult.rows.length > 0,
    });
  } catch (error) {
    return apiError(error);
  }
}
