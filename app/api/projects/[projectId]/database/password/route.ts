import { apiData, withOrg } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { revealProjectDatabasePassword } from "@/lib/platform/databases";

/**
 * Returns the Database password so the dashboard can reveal it on demand. The
 * value is never rendered into the page HTML: it is fetched only when the user
 * clicks, which keeps it out of the server response the browser caches.
 *
 * Owners and admins only. The AuditEvent records that a reveal happened, never
 * the password itself.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/projects/[projectId]/database/password">,
) {
  return withOrg(request, ["owner", "admin"], async (actor) => {
    const { projectId } = await context.params;
    const revealed = await revealProjectDatabasePassword({
      organizationId: actor.organizationId,
      projectId,
    });

    await recordAudit(
      "database.password_revealed",
      actor.organizationId,
      actor.userId,
      undefined,
      { projectId },
    );

    return apiData(revealed);
  });
}
