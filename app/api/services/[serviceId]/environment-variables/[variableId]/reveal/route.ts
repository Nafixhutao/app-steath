import { apiError } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { revealEnvironmentVariable } from "@/lib/platform/environment-variables";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

type RouteContext = { params: Promise<{ serviceId: string; variableId: string }> };

/**
 * Reveals one Environment Variable's value. This is the explicit request the
 * masking rule is built around, so it is a deliberate POST (never prefetchable,
 * never cached) and it answers no-store. Only owners and admins may reveal.
 * The AuditEvent records that the value was read, but not the value itself.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { serviceId, variableId } = await context.params;
    const revealed = await revealEnvironmentVariable({
      organizationId: actor.organizationId,
      serviceId,
      variableId,
    });

    await recordAudit(
      "environment_variable.revealed",
      actor.organizationId,
      actor.userId,
      undefined,
      { serviceId, variableId: revealed.id, key: revealed.key },
    );

    return new Response(JSON.stringify({ data: revealed }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
