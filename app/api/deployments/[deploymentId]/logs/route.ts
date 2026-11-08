import { apiData, apiError } from "@/lib/platform/api";
import { getDeployment, listBuildLog } from "@/lib/platform/deployments";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

type RouteContext = { params: Promise<{ deploymentId: string }> };

/**
 * Build log for a Deployment. The log is stored in PostgreSQL as it streams in,
 * so the dashboard can read it long after the Build finished.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin", "member"]);
    const { deploymentId } = await context.params;
    const deployment = await getDeployment(actor.organizationId, deploymentId);
    const lines = await listBuildLog(deployment.id);

    return apiData({ deployment, lines });
  } catch (error) {
    return apiError(error);
  }
}
