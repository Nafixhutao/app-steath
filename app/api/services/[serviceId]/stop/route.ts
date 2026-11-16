import { apiData, withOrg } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { getService } from "@/lib/platform/services";
import { stopService } from "@/lib/platform/runtime";

/**
 * Stops a Service. The container is kept so its writable state survives, and the
 * Platform Subdomain stops answering until the Service is started again.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/services/[serviceId]/stop">,
) {
  return withOrg(request, ["owner", "admin"], async (actor) => {
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
  });
}
