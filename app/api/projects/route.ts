import { ApiError, apiData, apiError } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { requireOrganizationRole } from "@/lib/platform/organization-management";
import { createProject, listProjects } from "@/lib/platform/projects";

export async function GET(request: Request) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin", "member"]);
    return apiData(await listProjects(actor.organizationId));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  let input: { name?: unknown; slug?: unknown };
  try {
    input = (await request.json()) as { name?: unknown; slug?: unknown };
  } catch {
    return apiError(new ApiError(400, "invalid_body", "Invalid request body."));
  }

  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const project = await createProject({
      organizationId: actor.organizationId,
      name: input.name,
      slug: input.slug,
    });

    await recordAudit("project.created", actor.organizationId, actor.userId, undefined, {
      projectId: project.id,
      name: project.name,
      slug: project.slug,
    });

    return apiData(project, 201);
  } catch (error) {
    return apiError(error);
  }
}
