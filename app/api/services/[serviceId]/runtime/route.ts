import { apiData, apiError } from "@/lib/platform/api";
import { getServiceRuntime } from "@/lib/platform/runtime";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

type RouteContext = { params: Promise<{ serviceId: string }> };

/**
 * Runtime state of a Service, read from the Node Agent. Members may read it; the
 * dashboard uses it to show whether the container is running or stopped.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin", "member"]);
    const { serviceId } = await context.params;

    return apiData(await getServiceRuntime(actor.organizationId, serviceId));
  } catch (error) {
    return apiError(error);
  }
}
