import { apiData, apiError } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { getService } from "@/lib/platform/services";
import { stopService } from "@/lib/platform/runtime";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

type RouteContext = { params: Promise<{ serviceId: string }> };

/**
 * Stops a Service. The container is kept so its writable state survives, and the
 * Platform Subdomain stops answering until the Service is started again.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { serviceId } = await context.params;
    const service = await getService(actor.organizationId, serviceId);

    const state = await stopService(actor.organizationId, serviceId);

    await recordAudit("service.stopped", actor.organizationId, actor.userId, undefined, {
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
