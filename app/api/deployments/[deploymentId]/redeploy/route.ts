import { apiData, apiError } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { redeployDeployment } from "@/lib/platform/deployments";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

type RouteContext = { params: Promise<{ deploymentId: string }> };

/**
 * Redeploys an existing Deployment: a new Deployment is created that rebuilds the
 * same commit, which is how an owner or admin restores a Service whose container
 * is misbehaving. Members may trigger a fresh Deployment, but only `owner` and
 * `admin` may redeploy a specific past commit.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { deploymentId } = await context.params;

    const redeployed = await redeployDeployment({
      organizationId: actor.organizationId,
      deploymentId,
      userId: actor.userId,
    });

    await recordAudit("deployment.triggered", actor.organizationId, actor.userId, undefined, {
      serviceId: redeployed.service.id,
      deploymentId: redeployed.deployment.id,
      redeployedFrom: deploymentId,
    });

    return apiData(redeployed.deployment, 201);
  } catch (error) {
    return apiError(error);
  }
}
