import { apiData, apiError } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { cancelDeployment } from "@/lib/platform/deployments";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

type RouteContext = { params: Promise<{ deploymentId: string }> };

/**
 * Cancels a Deployment that is still queued or building. Only `owner` and `admin`
 * may cancel, because stopping someone else's release is a management action.
 * The response reports what the Node Agent actually cleaned up, so the dashboard
 * can tell the user whether a container or image was removed.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { deploymentId } = await context.params;

    const cancelled = await cancelDeployment({
      organizationId: actor.organizationId,
      deploymentId,
    });

    await recordAudit("deployment.cancelled", actor.organizationId, actor.userId, undefined, {
      serviceId: cancelled.deployment.serviceId,
      deploymentId,
      buildCancelled: cancelled.aborted?.buildCancelled ?? null,
      containersRemoved: cancelled.aborted?.containersRemoved ?? null,
      imageRemoved: cancelled.aborted?.imageRemoved ?? null,
    });

    return apiData({ deployment: cancelled.deployment, aborted: cancelled.aborted });
  } catch (error) {
    return apiError(error);
  }
}
