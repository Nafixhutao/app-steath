import { apiData, apiError } from "@/lib/platform/api";
import { listNodes } from "@/lib/platform/nodes";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

/**
 * Node status for the dashboard. Every Organization may read it because the
 * node is platform-wide and its health explains why Deployments are blocked.
 */
export async function GET(request: Request) {
  const headers = request.headers;

  try {
    await requireOrganizationRole(headers, ["owner", "admin", "member"]);
    const nodes = await listNodes();
    return apiData(nodes);
  } catch (error) {
    return apiError(error);
  }
}
