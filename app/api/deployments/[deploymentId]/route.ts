import { apiData, withOrg } from "@/lib/platform/api";
import { getDeployment } from "@/lib/platform/deployments";

export async function GET(
  request: Request,
  context: RouteContext<"/api/deployments/[deploymentId]">,
) {
  return withOrg(request, ["owner", "admin", "member"], async (actor) => {
    const { deploymentId } = await context.params;
    return apiData(await getDeployment(actor.organizationId, deploymentId));
  });
}
