import { apiData, apiError } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { listDeployments, triggerDeployment } from "@/lib/platform/deployments";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

type RouteContext = { params: Promise<{ serviceId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin", "member"]);
    const { serviceId } = await context.params;
    return apiData(await listDeployments(actor.organizationId, serviceId));
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Triggers a Deployment. Members may deploy too, as the spec allows, but the
 * AuditEvent still records who did it.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin", "member"]);
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
  } catch (error) {
    return apiError(error);
  }
}
