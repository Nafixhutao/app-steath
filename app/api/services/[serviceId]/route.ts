import { ApiError, apiData, apiError, withOrg } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { requireOrganizationRole } from "@/lib/platform/organization-management";
import { deleteService, getService } from "@/lib/platform/services";

export async function GET(request: Request, context: RouteContext<"/api/services/[serviceId]">) {
  return withOrg(request, ["owner", "admin", "member"], async (actor) => {
    const { serviceId } = await context.params;
    return apiData(await getService(actor.organizationId, serviceId));
  });
}

export async function DELETE(request: Request, context: RouteContext<"/api/services/[serviceId]">) {
  let input: { confirmation?: unknown };
  try {
    input = (await request.json()) as { confirmation?: unknown };
  } catch {
    return apiError(new ApiError(400, "invalid_body", "Invalid request body."));
  }

  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { serviceId } = await context.params;
    const deleted = await deleteService({
      organizationId: actor.organizationId,
      serviceId,
      confirmation: input.confirmation,
    });

    await recordAudit("service.deleted", actor.organizationId, actor.userId, undefined, {
      projectId: deleted.projectId,
      serviceId: deleted.id,
      name: deleted.name,
      slug: deleted.slug,
    });

    return apiData({ id: deleted.id });
  } catch (error) {
    return apiError(error);
  }
}
