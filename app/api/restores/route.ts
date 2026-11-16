import { apiData, withOrg } from "@/lib/platform/api";
import { listRestores } from "@/lib/platform/restores";

/**
 * Recent Restores for the active Organization. Every role may read them so a
 * member can see whether a Restore is still running.
 */
export async function GET(request: Request) {
  return withOrg(request, ["owner", "admin", "member"], async (actor) => {
    return apiData(await listRestores(actor.organizationId));
  });
}
