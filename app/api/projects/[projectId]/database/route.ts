import { ApiError, apiData, apiError } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import {
  createProjectDatabase,
  deleteProjectDatabase,
  getProjectDatabase,
} from "@/lib/platform/databases";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

type RouteContext = { params: Promise<{ projectId: string }> };

/**
 * Reads a Project's Database, its health, and its usage. Every role may see the
 * state; only owners and admins receive the private connection string.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin", "member"]);
    const { projectId } = await context.params;
    return apiData(
      await getProjectDatabase({
        organizationId: actor.organizationId,
        projectId,
        includeConnectionString: actor.role !== "member",
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Provisions the Project's one PostgreSQL Database. Owners and admins manage
 * configuration; the Node Agent starts the container on the Project network.
 */
export async function POST(request: Request, context: RouteContext) {
  let input: { storageLimitMb?: unknown };
  try {
    input = (await request.json().catch(() => ({}))) as { storageLimitMb?: unknown };
  } catch {
    return apiError(new ApiError(400, "invalid_body", "Invalid request body."));
  }

  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { projectId } = await context.params;
    const created = await createProjectDatabase({
      organizationId: actor.organizationId,
      projectId,
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
export async function DELETE(request: Request, context: RouteContext) {
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
