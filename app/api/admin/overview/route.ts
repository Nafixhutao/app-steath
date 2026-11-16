import { apiData, withAdmin } from "@/lib/platform/api";
import { getAdminOverview } from "@/lib/platform/admin-read-queries";

/**
 * Admin Overview — mirrors stealth-forge's `/v1/admin/overview` payload shape:
 * component health (api/postgres/redis/agent), platform operation counts, and
 * the newest deployments across all projects. The optional HTTP block stays
 * absent because paas does not record request telemetry.
 */

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    return apiData(await getAdminOverview());
  });
}
