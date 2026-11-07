import { ApiError, apiData, apiError } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { requireOrganizationRole } from "@/lib/platform/organization-management";
import { deleteProject, getProject, updateProject } from "@/lib/platform/projects";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin", "member"]);
    const { projectId } = await context.params;
    return apiData(await getProject(actor.organizationId, projectId));
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
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
