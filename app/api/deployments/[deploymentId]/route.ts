import { apiData, apiError } from "@/lib/platform/api";
import { getDeployment } from "@/lib/platform/deployments";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

export async function GET(request: Request, context: RouteContext<'/api/deployments/[deploymentId]'>) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin", "member"]);
    const { deploymentId } = await context.params;
    return apiData(await getDeployment(actor.organizationId, deploymentId));
  } catch (error) {
    return apiError(error);
  }
}
