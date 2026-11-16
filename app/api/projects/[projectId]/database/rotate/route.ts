import { apiData, apiError } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { rotateProjectDatabaseCredentials } from "@/lib/platform/databases";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

type RouteContext = { params: Promise<{ projectId: string }> };

/**
 * Replaces the Database password inside the running cluster. The AuditEvent
 * records that a rotation happened, never the new value.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { projectId } = await context.params;
    const rotated = await rotateProjectDatabaseCredentials({
      organizationId: actor.organizationId,
      projectId,
    });

    await recordAudit(
      "database.credentials_rotated",
      actor.organizationId,
      actor.userId,
      undefined,
      { projectId, databaseId: rotated.id },
    );

    return apiData(rotated);
  } catch (error) {
    return apiError(error);
  }
}
