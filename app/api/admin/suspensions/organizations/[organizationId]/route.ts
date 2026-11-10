import { apiData, apiError, ApiError } from "@/lib/platform/api";
import { requirePlatformAdmin } from "@/lib/platform/platform-admin";
import { recordPlatformAudit } from "@/lib/platform/audit";
import { suspendOrganization, unsuspendOrganization } from "@/lib/platform/suspensions";

type Context = { params: Promise<{ organizationId: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const actor = await requirePlatformAdmin(request.headers);
    const { action } = (await request.json()) as { action?: unknown };
    if (action !== "suspend" && action !== "unsuspend")
      throw new ApiError(400, "invalid_action", "Action must be suspend or unsuspend.");
    const { organizationId } = await context.params;
    if (action === "suspend") await suspendOrganization(organizationId);
    else await unsuspendOrganization(organizationId);
    await recordPlatformAudit(`platform.organization.${action}ed`, actor.userId, {
      organizationId,
    });
    return apiData({ organizationId, action });
  } catch (error) {
    return apiError(error);
  }
}
