import { apiData, withOrg } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { rotateProjectDatabaseCredentials } from "@/lib/platform/databases";

/**
 * Replaces the Database password inside the running cluster. The AuditEvent
 * records that a rotation happened, never the new value.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/projects/[projectId]/database/rotate">,
) {
  return withOrg(request, ["owner", "admin"], async (actor) => {
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
  });
}
