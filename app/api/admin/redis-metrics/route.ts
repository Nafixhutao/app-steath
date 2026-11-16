import { apiData, withAdmin } from "@/lib/platform/api";
import { getAdminRedisMetrics } from "@/lib/platform/admin-read-queries";

/**
 * Admin Redis metrics — mirrors stealth-forge's `/v1/admin/redis-metrics`.
 * The production paas stack has no Redis service yet, so the sampler answers
 * `reachable: false` with empty history and the Overview panel renders its
 * honest unavailable state. When a Redis service is added (REDIS_URL), the
 * same endpoint reports its INFO numbers.
 */

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const url = new URL(request.url);
    const rawWindow = url.searchParams.get("window_minutes");
    let windowMinutes = 5;
    if (rawWindow !== null && rawWindow !== "") {
      windowMinutes = Number.parseInt(rawWindow, 10);
      if (!Number.isFinite(windowMinutes) || windowMinutes < 1) {
        windowMinutes = 5;
      }
    }

    return apiData(await getAdminRedisMetrics(windowMinutes));
  });
}
