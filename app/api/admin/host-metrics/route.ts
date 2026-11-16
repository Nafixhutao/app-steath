import { apiData, withAdmin } from "@/lib/platform/api";
import { getAdminHostMetrics } from "@/lib/platform/admin-read-queries";

/**
 * Admin host metrics — mirrors stealth-forge's `/v1/admin/host-metrics`: the
 * node's own CPU, memory, and storage samples inside the window, in the exact
 * byte-based wire shape the ported charts render. A window is capped at 24
 * hours to match the retention pass.
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

    return apiData(await getAdminHostMetrics(windowMinutes));
  });
}
