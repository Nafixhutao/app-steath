import { apiData, withOrg } from "@/lib/platform/api";
import { getServiceRuntime } from "@/lib/platform/runtime";

/**
 * Runtime state of a Service, read from the Node Agent. Members may read it; the
 * dashboard uses it to show whether the container is running or stopped.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/services/[serviceId]/runtime">,
) {
  return withOrg(request, ["owner", "admin", "member"], async (actor) => {
    const { serviceId } = await context.params;

    return apiData(await getServiceRuntime(actor.organizationId, serviceId));
  });
}
