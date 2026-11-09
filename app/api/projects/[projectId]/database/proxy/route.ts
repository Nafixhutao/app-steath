import { ApiError, apiData, apiError } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import {
  disableProjectDatabaseProxy,
  enableProjectDatabaseProxy,
  getProjectDatabase,
} from "@/lib/platform/databases";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

type RouteContext = { params: Promise<{ projectId: string }> };

/**
 * Reads the public proxy state. Every role may see whether it is enabled and
 * which CIDRs are allowed; only owners and admins receive the public connection
 * string, because it carries the password.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin", "member"]);
    const { projectId } = await context.params;
    const state = await getProjectDatabase({
      organizationId: actor.organizationId,
      projectId,
      includeConnectionString: actor.role !== "member",
    });

    if (!state.database) {
      throw new ApiError(404, "database_not_found", "This Project has no Database.");
    }

    return apiData(state.database.proxy);
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Enables the public proxy or replaces its allowlist. The body must carry at
 * least one CIDR: a public Database is never open to every address by accident.
 */
export async function PUT(request: Request, context: RouteContext) {
  let input: { allowlist?: unknown };
  try {
    input = (await request.json()) as { allowlist?: unknown };
  } catch {
    return apiError(new ApiError(400, "invalid_body", "Invalid request body."));
  }

  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { projectId } = await context.params;
    const { databaseId, proxy } = await enableProjectDatabaseProxy({
      organizationId: actor.organizationId,
      projectId,
      allowlist: input.allowlist,
    });

    await recordAudit("database.proxy_enabled", actor.organizationId, actor.userId, undefined, {
      projectId,
      databaseId,
      port: proxy.port,
      allowlist: proxy.allowlist,
    });

    return apiData(proxy);
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Disables the public proxy. The agent stops the listener and revokes the port
 * before the Control Plane forgets the endpoint.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { projectId } = await context.params;
    const { databaseId, proxy, changed } = await disableProjectDatabaseProxy({
      organizationId: actor.organizationId,
      projectId,
    });

    if (changed) {
      await recordAudit(
        "database.proxy_disabled",
        actor.organizationId,
        actor.userId,
        undefined,
        {
          projectId,
          databaseId,
        },
      );
    }

    return apiData(proxy);
  } catch (error) {
    return apiError(error);
  }
}
