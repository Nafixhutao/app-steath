import { apiData, withOrg } from "@/lib/platform/api";
import { getDeployment, listBuildLog } from "@/lib/platform/deployments";

/**
 * Build log for a Deployment. The log is stored in PostgreSQL as it streams in,
 * so the dashboard can read it long after the Build finished.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/deployments/[deploymentId]/logs">,
) {
  return withOrg(request, ["owner", "admin", "member"], async (actor) => {
    const { deploymentId } = await context.params;
    const deployment = await getDeployment(actor.organizationId, deploymentId);
    const lines = await listBuildLog(deployment.id);

    return apiData({ deployment, lines });
  });
}
