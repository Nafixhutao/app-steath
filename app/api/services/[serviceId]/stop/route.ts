import { apiData, withOrg } from "@/lib/platform/api";
import { requestServiceLifecycle } from "@/lib/platform/runtime";

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
    const state = await requestServiceLifecycle({
      organizationId: actor.organizationId,
      userId: actor.userId,
      serviceId,
      action: "stop",
    });

    return apiData(state);
  });
}
