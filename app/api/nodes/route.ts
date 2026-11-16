import { apiData, withOrg } from "@/lib/platform/api";
import { listNodes } from "@/lib/platform/nodes";

/**
 * Node status for the dashboard. Every Organization may read it because the
 * node is platform-wide and its health explains why Deployments are blocked.
 */
export async function GET(request: Request) {
  return withOrg(request, ["owner", "admin", "member"], async () => {
    return apiData(await listNodes());
  });
}
