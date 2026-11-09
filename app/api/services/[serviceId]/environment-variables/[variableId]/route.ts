import { ApiError, apiData, apiError } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import {
  deleteEnvironmentVariable,
  updateEnvironmentVariable,
} from "@/lib/platform/environment-variables";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

type RouteContext = { params: Promise<{ serviceId: string; variableId: string }> };

/**
 * Updates an Environment Variable's key, value, or both. The AuditEvent records
 * which key changed, never what it changed to.
 */
export async function PATCH(request: Request, context: RouteContext) {
  let input: { key?: unknown; value?: unknown };
  try {
    input = (await request.json()) as { key?: unknown; value?: unknown };
  } catch {
    return apiError(new ApiError(400, "invalid_body", "Invalid request body."));
  }

  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { serviceId, variableId } = await context.params;
    const updated = await updateEnvironmentVariable({
      organizationId: actor.organizationId,
      serviceId,
      variableId,
      key: input.key,
      value: input.value,
    });

    await recordAudit(
      "environment_variable.updated",
      actor.organizationId,
      actor.userId,
      undefined,
      { serviceId, variableId: updated.id, key: updated.key },
    );

    return apiData(updated);
  } catch (error) {
    return apiError(error);
  }
}

/** Removes one Environment Variable. The values it sealed are gone with it. */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { serviceId, variableId } = await context.params;
    const deleted = await deleteEnvironmentVariable({
      organizationId: actor.organizationId,
      serviceId,
      variableId,
    });

    await recordAudit(
      "environment_variable.deleted",
      actor.organizationId,
      actor.userId,
      undefined,
      { serviceId, variableId: deleted.id },
    );

    return apiData(deleted);
  } catch (error) {
    return apiError(error);
  }
}
