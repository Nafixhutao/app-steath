import { ApiError } from "@/lib/platform/api-error";
import { apiData, apiError, withOrg } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { requireOrganizationRole } from "@/lib/platform/organization-management";
import { deleteProject, getProject, updateProject } from "@/lib/platform/projects";

export async function GET(request: Request, context: RouteContext<"/api/projects/[projectId]">) {
  return withOrg(request, ["owner", "admin", "member"], async (actor) => {
    const { projectId } = await context.params;
    return apiData(await getProject(actor.organizationId, projectId));
  });
}

export async function PATCH(request: Request, context: RouteContext<"/api/projects/[projectId]">) {
  let input: { name?: unknown; slug?: unknown };
  try {
    input = (await request.json()) as { name?: unknown; slug?: unknown };
  } catch {
    return apiError(new ApiError(400, "invalid_body", "Invalid request body."));
  }

  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { projectId } = await context.params;
    const project = await updateProject({
      organizationId: actor.organizationId,
      projectId,
      name: input.name,
      slug: input.slug,
    });

    await recordAudit("project.updated", actor.organizationId, actor.userId, undefined, {
      projectId: project.id,
      name: project.name,
      slug: project.slug,
    });

    return apiData(project);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext<"/api/projects/[projectId]">) {
  let input: { confirmation?: unknown };
  try {
    input = (await request.json()) as { confirmation?: unknown };
  } catch {
    return apiError(new ApiError(400, "invalid_body", "Invalid request body."));
  }

  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { projectId } = await context.params;
    const deleted = await deleteProject({
      organizationId: actor.organizationId,
      projectId,
      confirmation: input.confirmation,
    });

    await recordAudit("project.deleted", actor.organizationId, actor.userId, undefined, {
      projectId: deleted.id,
      name: deleted.name,
      slug: deleted.slug,
    });

    return apiData({ id: deleted.id });
  } catch (error) {
    return apiError(error);
  }
}
