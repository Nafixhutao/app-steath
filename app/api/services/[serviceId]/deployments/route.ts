import { apiData, withOrg } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { listDeployments, triggerDeployment } from "@/lib/platform/deployments";

export async function GET(
  request: Request,
  context: RouteContext<"/api/services/[serviceId]/deployments">,
) {
  return withOrg(request, ["owner", "admin", "member"], async (actor) => {
    const { serviceId } = await context.params;
    return apiData(await listDeployments(actor.organizationId, serviceId));
  });
}

/**
 * Triggers a Deployment. Members may deploy too, as the spec allows, but the
 * AuditEvent still records who did it.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/services/[serviceId]/deployments">,
) {
  return withOrg(request, ["owner", "admin", "member"], async (actor) => {
    const { serviceId } = await context.params;
    const triggered = await triggerDeployment({
      organizationId: actor.organizationId,
      serviceId,
      userId: actor.userId,
    });

    await recordAudit("deployment.triggered", actor.organizationId, actor.userId, undefined, {
      serviceId: triggered.service.id,
      deploymentId: triggered.deployment.id,
    });

    return apiData(triggered.deployment, 201);
  });
}
