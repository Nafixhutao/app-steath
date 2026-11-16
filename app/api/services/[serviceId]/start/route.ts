import { apiData, withOrg } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { getService } from "@/lib/platform/services";
import { startService } from "@/lib/platform/runtime";

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
    const service = await getService(actor.organizationId, serviceId);

    const state = await startService(actor.organizationId, serviceId);

    await recordAudit("service.started", actor.organizationId, actor.userId, undefined, {
      projectId: service.projectId,
      serviceId,
      name: service.name,
      hostname: service.platformHostname,
    });

    return apiData(state);
  });
}
