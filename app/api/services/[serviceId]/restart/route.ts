import { apiData, withOrg } from "@/lib/platform/api";
import { requestServiceLifecycle } from "@/lib/platform/runtime";

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
    const state = await requestServiceLifecycle({
      organizationId: actor.organizationId,
      userId: actor.userId,
      serviceId,
      action: "restart",
    });

    return apiData(state);
  });
}
