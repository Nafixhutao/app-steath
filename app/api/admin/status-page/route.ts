import { apiData, withAdmin } from "@/lib/platform/api";
import { getAdminStatusPage } from "@/lib/platform/admin-read-queries";

/**
 * Admin status page — mirrors stealth-forge's `/v1/admin/status-page`. The
 * components are the same health probes the Overview answers (api, postgres,
 * redis, agent) mapped onto the public status vocabulary; `published_incidents`
 * lists the active incident titles. Forge stores a configurable page; paas
 * derives the current state at request time, which is what the ported Status
 * Page renders.
 */

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    return apiData(await getAdminStatusPage());
  });
}
