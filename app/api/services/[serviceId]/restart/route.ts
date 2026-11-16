import { apiData, withOrg } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { getService } from "@/lib/platform/services";
import { restartService } from "@/lib/platform/runtime";

/**
 * Restarts a Service container without changing its configuration. The route
 * stays in place, so the hostname keeps answering once the app is up again.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/services/[serviceId]/restart">,
) {
  return withOrg(request, ["owner", "admin"], async (actor) => {
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
  });
}
