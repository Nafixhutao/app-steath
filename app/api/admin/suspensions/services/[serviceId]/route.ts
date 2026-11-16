import { apiData, ApiError, readJson, withAdmin } from "@/lib/platform/api";
import { recordPlatformAudit } from "@/lib/platform/audit";
import { suspendService, unsuspendService } from "@/lib/platform/suspensions";

export async function POST(
  request: Request,
  context: RouteContext<"/api/admin/suspensions/services/[serviceId]">,
) {
  return withAdmin(request, async (actor) => {
    const { action } = await readJson<{ action?: unknown }>(request);
    if (action !== "suspend" && action !== "unsuspend")
      throw new ApiError(400, "invalid_action", "Action must be suspend or unsuspend.");
    const { serviceId } = await context.params;
    if (action === "suspend") await suspendService(serviceId);
    else await unsuspendService(serviceId);
    await recordPlatformAudit(`platform.service.${action}ed`, actor.userId, { serviceId });
    return apiData({ serviceId, action });
  });
}
