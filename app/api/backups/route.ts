import { apiData, withOrg } from "@/lib/platform/api";
import { listBackups } from "@/lib/platform/backups";

/**
 * Backups for the active Organization, plus the platform PostgreSQL Backups.
 * Every role may read the list; the dashboard warns when storage is local.
 */
export async function GET(request: Request) {
  return withOrg(request, ["owner", "admin", "member"], async (actor) => {
    return apiData(await listBackups(actor.organizationId));
  });
}
