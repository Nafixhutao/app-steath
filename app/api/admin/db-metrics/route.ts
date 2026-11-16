import { apiData, withAdmin } from "@/lib/platform/api";
import { getAdminDbMetrics } from "@/lib/platform/admin-read-queries";

/**
 * Admin DB metrics — mirrors stealth-forge's `/v1/admin/db-metrics`: one
 * snapshot of PostgreSQL's own statistics plus the retained history inside the
 * window. Forge samples in-process every 5s with a 720-sample ring; paas keeps
 * the same sampler shape but reads PostgreSQL at request time and stores each
 * sample in `admin_db_metric`, so history survives restarts. A window is
 * capped at 24 hours to match the retention pass.
 */

const CURRENT_WINDOW_MINUTES = 5;

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const url = new URL(request.url);
    const rawWindow = url.searchParams.get("window_minutes");
    let windowMinutes = CURRENT_WINDOW_MINUTES;
    if (rawWindow !== null && rawWindow !== "") {
      windowMinutes = Number.parseInt(rawWindow, 10);
      if (!Number.isFinite(windowMinutes) || windowMinutes < 1) {
        windowMinutes = CURRENT_WINDOW_MINUTES;
      }
    }

    return apiData(await getAdminDbMetrics(windowMinutes));
  });
}
