import { apiData, ApiError, readJson, withAdmin } from "@/lib/platform/api";
import { recordPlatformAudit } from "@/lib/platform/audit";
import { suspendOrganization, unsuspendOrganization } from "@/lib/platform/suspensions";

export async function POST(
  request: Request,
  context: RouteContext<"/api/admin/suspensions/organizations/[organizationId]">,
) {
  return withAdmin(request, async (actor) => {
    const { action } = await readJson<{ action?: unknown }>(request);
    if (action !== "suspend" && action !== "unsuspend")
      throw new ApiError(400, "invalid_action", "Action must be suspend or unsuspend.");
    const { organizationId } = await context.params;
    if (action === "suspend") await suspendOrganization(organizationId);
    else await unsuspendOrganization(organizationId);
    await recordPlatformAudit(`platform.organization.${action}ed`, actor.userId, {
      organizationId,
    });
    return apiData({ organizationId, action });
  });
}
