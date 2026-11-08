import { apiData, apiError } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { getService } from "@/lib/platform/services";
import { startService } from "@/lib/platform/runtime";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

type RouteContext = { params: Promise<{ serviceId: string }> };

/**
 * Starts a stopped Service. The same container comes back, so any data it kept in
 * its writable layer or Volumes is still there.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
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
  } catch (error) {
    return apiError(error);
  }
}
