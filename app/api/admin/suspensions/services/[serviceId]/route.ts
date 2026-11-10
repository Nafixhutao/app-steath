import { apiData, apiError, ApiError } from "@/lib/platform/api";
import { requirePlatformAdmin } from "@/lib/platform/platform-admin";
import { recordPlatformAudit } from "@/lib/platform/audit";
import { suspendService, unsuspendService } from "@/lib/platform/suspensions";

type Context = { params: Promise<{ serviceId: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const actor = await requirePlatformAdmin(request.headers);
    const { action } = (await request.json()) as { action?: unknown };
    if (action !== "suspend" && action !== "unsuspend")
      throw new ApiError(400, "invalid_action", "Action must be suspend or unsuspend.");
    const { serviceId } = await context.params;
    if (action === "suspend") await suspendService(serviceId);
    else await unsuspendService(serviceId);
    await recordPlatformAudit(`platform.service.${action}ed`, actor.userId, { serviceId });
    return apiData({ serviceId, action });
  } catch (error) {
    return apiError(error);
  }
}
