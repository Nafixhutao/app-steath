import { apiData, apiError } from "@/lib/platform/api";
import { requireOrganizationRole } from "@/lib/platform/organization-management";
import { listRestores } from "@/lib/platform/restores";

/**
 * Recent Restores for the active Organization. Every role may read them so a
 * member can see whether a Restore is still running.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin", "member"]);

    return apiData(await listRestores(actor.organizationId));
  } catch (error) {
    return apiError(error);
  }
}
