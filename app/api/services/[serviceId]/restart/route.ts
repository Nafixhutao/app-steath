import { apiData, apiError } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { getService } from "@/lib/platform/services";
import { restartService } from "@/lib/platform/runtime";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

type RouteContext = { params: Promise<{ serviceId: string }> };

/**
 * Restarts a Service container without changing its configuration. The route
 * stays in place, so the hostname keeps answering once the app is up again.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { serviceId } = await context.params;
    const service = await getService(actor.organizationId, serviceId);

    const state = await restartService(actor.organizationId, serviceId);

    await recordAudit("service.restarted", actor.organizationId, actor.userId, undefined, {
      projectId: service.projectId,
      serviceId,
      name: service.name,
      hostname: service.platformHostname,
    });

    return apiData(state);
  } catch (error) {
    return apiError(error);
  }
}
