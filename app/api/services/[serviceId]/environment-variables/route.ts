import { ApiError, apiData, apiError } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import {
  createEnvironmentVariable,
  listEnvironmentVariables,
} from "@/lib/platform/environment-variables";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

type RouteContext = { params: Promise<{ serviceId: string }> };

/**
 * Lists a Service's Environment Variables. Every role may see the keys, but the
 * values are always masked here: only an explicit reveal returns a value, and
 * that is limited to owners and admins.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin", "member"]);
    const { serviceId } = await context.params;
    return apiData(await listEnvironmentVariables(actor.organizationId, serviceId));
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Adds an Environment Variable. Only owners and admins manage configuration.
 * The AuditEvent records the key, never the value, so the secret stays out of
 * the audit trail.
 */
export async function POST(request: Request, context: RouteContext) {
  let input: { key?: unknown; value?: unknown };
  try {
    input = (await request.json()) as { key?: unknown; value?: unknown };
  } catch {
    return apiError(new ApiError(400, "invalid_body", "Invalid request body."));
  }

  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { serviceId } = await context.params;
    const created = await createEnvironmentVariable({
      organizationId: actor.organizationId,
      serviceId,
      key: input.key,
      value: input.value,
    });

    await recordAudit(
      "environment_variable.created",
      actor.organizationId,
      actor.userId,
      undefined,
      { serviceId, variableId: created.id, key: created.key },
    );

    return apiData(created, 201);
  } catch (error) {
    return apiError(error);
  }
}
