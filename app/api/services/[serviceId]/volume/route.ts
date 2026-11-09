import { ApiError, apiData, apiError } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { requireOrganizationRole } from "@/lib/platform/organization-management";
import { createServiceVolume, deleteServiceVolume, getServiceVolume } from "@/lib/platform/volumes";

type RouteContext = { params: Promise<{ serviceId: string }> };

/**
 * Reads a Service's Volume and its usage. Every role may see it: members need to
 * know how much space the Service is using.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin", "member"]);
    const { serviceId } = await context.params;
    return apiData(await getServiceVolume(actor.organizationId, serviceId));
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Adds the Service's one Volume. Owners and admins manage configuration; the
 * Docker Volume is created by the Node Agent on the next Deployment.
 */
export async function POST(request: Request, context: RouteContext) {
  let input: { mountPath?: unknown; sizeMb?: unknown };
  try {
    input = (await request.json()) as { mountPath?: unknown; sizeMb?: unknown };
  } catch {
    return apiError(new ApiError(400, "invalid_body", "Invalid request body."));
  }

  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { serviceId } = await context.params;
    const created = await createServiceVolume({
      organizationId: actor.organizationId,
      serviceId,
      mountPath: input.mountPath,
      sizeMb: input.sizeMb,
    });

    await recordAudit("volume.created", actor.organizationId, actor.userId, undefined, {
      serviceId,
      volumeId: created.id,
      mountPath: created.mountPath,
      sizeMb: created.sizeMb,
    });

    return apiData(created, 201);
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Deletes the Volume and its data. The agent removes the Docker Volume, then the
 * row disappears and the Service is marked as needing a redeploy so the mount is
 * dropped from the next container.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { serviceId } = await context.params;
    const deleted = await deleteServiceVolume({
      organizationId: actor.organizationId,
      serviceId,
    });

    await recordAudit("volume.deleted", actor.organizationId, actor.userId, undefined, {
      serviceId,
      volumeId: deleted.id,
      dockerVolumeName: deleted.dockerVolumeName,
    });

    return apiData({ id: deleted.id });
  } catch (error) {
    return apiError(error);
  }
}
