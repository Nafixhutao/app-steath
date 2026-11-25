import { ApiError } from "@/lib/platform/api-error";
import { apiData, apiError, withOrg } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import {
  createProjectDatabase,
  deleteProjectDatabase,
  getProjectDatabase,
} from "@/lib/platform/databases";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

/**
 * Reads a Project's Database, its health, its usage, and the phpMyAdmin address
 * a MySQL Database serves. Every role may see the state; only owners and admins
 * receive the private connection string.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/projects/[projectId]/database">,
) {
  return withOrg(request, ["owner", "admin", "member"], async (actor) => {
    const { projectId } = await context.params;
    return apiData(
      await getProjectDatabase({
        organizationId: actor.organizationId,
        projectId,
        includeConnectionString: actor.role !== "member",
      }),
    );
  });
}

/**
 * Provisions the Project's one Database, PostgreSQL or MySQL, chosen by the
 * caller and fixed afterwards. Owners and admins manage configuration; the Node
 * Agent starts the container on the Project network, plus a phpMyAdmin sidecar
 * for MySQL.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/projects/[projectId]/database">,
) {
  let input: { engine?: unknown; storageLimitMb?: unknown };
  try {
    input = (await request.json().catch(() => ({}))) as {
      engine?: unknown;
      storageLimitMb?: unknown;
    };
  } catch {
    return apiError(new ApiError(400, "invalid_body", "Invalid request body."));
  }

  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { projectId } = await context.params;
    const created = await createProjectDatabase({
      organizationId: actor.organizationId,
      projectId,
      engine: input.engine,
      storageLimitMb: input.storageLimitMb,
    });

    await recordAudit("database.created", actor.organizationId, actor.userId, undefined, {
      projectId,
      databaseId: created.id,
      engine: created.engine,
      version: created.version,
      storageLimitMb: created.storageLimitMb,
    });

    return apiData(created, 201);
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Deletes the Database and its data after the caller types the Project name.
 * The agent removes the container and Volume, then the Project's Services are
 * marked as needing a redeploy so `DATABASE_URL` is dropped from them.
 */
export async function DELETE(
  request: Request,
  context: RouteContext<"/api/projects/[projectId]/database">,
) {
  let input: { confirmation?: unknown };
  try {
    input = (await request.json()) as { confirmation?: unknown };
  } catch {
    return apiError(new ApiError(400, "invalid_body", "Invalid request body."));
  }

  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { projectId } = await context.params;
    const deleted = await deleteProjectDatabase({
      organizationId: actor.organizationId,
      projectId,
      confirmation: input.confirmation,
    });

    await recordAudit("database.deleted", actor.organizationId, actor.userId, undefined, {
      projectId,
      databaseId: deleted.id,
      engine: deleted.engine,
      version: deleted.version,
    });

    return apiData({ id: deleted.id });
  } catch (error) {
    return apiError(error);
  }
}
