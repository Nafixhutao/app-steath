import { apiData, withOrg } from "@/lib/platform/api";
import { requestServiceLifecycle } from "@/lib/platform/runtime";

/**
 * Starts a stopped Service. The same container comes back, so any data it kept in
 * its writable layer or Volumes is still there.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/services/[serviceId]/start">,
) {
  return withOrg(request, ["owner", "admin"], async (actor) => {
    const { serviceId } = await context.params;
    const state = await requestServiceLifecycle({
      organizationId: actor.organizationId,
      userId: actor.userId,
      serviceId,
      action: "start",
    });

    return apiData(state);
  });
}
