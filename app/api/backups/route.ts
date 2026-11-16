import { apiData, apiError } from "@/lib/platform/api";
import { listBackups } from "@/lib/platform/backups";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

/**
 * Backups for the active Organization, plus the platform PostgreSQL Backups.
 * Every role may read the list; the dashboard warns when storage is local.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin", "member"]);

    return apiData(await listBackups(actor.organizationId));
  } catch (error) {
    return apiError(error);
  }
}
