import { apiData, withOrg } from "@/lib/platform/api";
import { ApiError } from "@/lib/platform/api-error";
import { recordAudit } from "@/lib/platform/audit";
import { getProjectDatabase, sharedPhpMyAdminHostname } from "@/lib/platform/databases";
import { issuePhpMyAdminToken } from "@/lib/platform/phpmyadmin-sso";

/**
 * Mints the one-time link the dashboard opens for a logged-in phpMyAdmin.
 *
 * The link points at the phpMyAdmin hostname's sign-in bridge, not at this API,
 * because phpMyAdmin's session cookie is same-origin and `__Secure-`: a session
 * started anywhere else would never be sent back to phpMyAdmin. The token
 * expires in 60 seconds and is spent on first use.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/projects/[projectId]/database/phpmyadmin">,
) {
  return withOrg(request, ["owner", "admin"], async (actor) => {
    const { projectId } = await context.params;
    const current = await getProjectDatabase({
      organizationId: actor.organizationId,
      projectId,
      includeConnectionString: false,
    });

    if (!current.database) {
      throw new ApiError(404, "database_not_found", "This Project has no Database.");
    }
    if (!current.database.phpMyAdmin.enabled) {
      throw new ApiError(
        409,
        "phpmyadmin_unsupported",
        "phpMyAdmin is only available for a MySQL Database.",
      );
    }

    const token = issuePhpMyAdminToken(current.database.id);
    const hostname = current.database.phpMyAdmin.hostname ?? sharedPhpMyAdminHostname();

    await recordAudit(
      "database.phpmyadmin_signed_in",
      actor.organizationId,
      actor.userId,
      undefined,
      { projectId, databaseId: current.database.id },
    );

    return apiData({
      url: `https://${hostname}/_sso?token=${encodeURIComponent(token)}`,
      expiresInSeconds: 60,
    });
  });
}
