import { apiData, withAdmin } from "@/lib/platform/api";
import { BUILD_LOG_LEVELS, tailBuildLogs } from "@/lib/platform/admin-work-queries";

/**
 * Admin log tail — mirrors stealth-forge's `/v1/admin/telemetry/logs`. Forge
 * reads an OTLP collector; paas has no telemetry backend, so the tail reads
 * the Build log lines the worker already streams into `build_log` (the one log
 * store paas has). `from`/`to` bound the window, `service`/`query` filter it
 * exactly like the source endpoint. `build_log` has no level column, so the
 * level is derived from the message the same way Forge's adapter normalizes
 * collector severities.
 */

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const service = url.searchParams.get("service");
    const level = url.searchParams.get("level")?.toUpperCase() ?? null;
    const search = url.searchParams.get("query");
    const rawLimit = url.searchParams.get("limit");
    let limit = 250;
    if (rawLimit !== null && rawLimit !== "") {
      limit = Number.parseInt(rawLimit, 10);
      if (!Number.isFinite(limit) || limit < 1) limit = 250;
    }
    limit = Math.min(limit, 1000);

    const { items } = await tailBuildLogs({ from, to, service, search, limit });

    return apiData({
      items: level
        ? items.filter((item) => BUILD_LOG_LEVELS.has(level) && item.level === level)
        : items,
    });
  });
}
