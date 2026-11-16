import { apiData, withOrg } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { cancelDeployment } from "@/lib/platform/deployments";

/**
 * Cancels a Deployment that is still queued or building. Only `owner` and `admin`
 * may cancel, because stopping someone else's deployment is a management action.
 * The response reports what the Node Agent actually cleaned up, so the dashboard
 * can tell the user whether a container or image was removed.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/deployments/[deploymentId]/cancel">,
) {
  return withOrg(request, ["owner", "admin"], async (actor) => {
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
  });
}
