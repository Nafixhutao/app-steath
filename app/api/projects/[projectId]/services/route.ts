import { ApiError } from "@/lib/platform/api-error";
import { apiData, apiError, withOrg } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { requireOrganizationRole } from "@/lib/platform/organization-management";
import { createService, listServices } from "@/lib/platform/services";

export async function GET(
  request: Request,
  context: RouteContext<"/api/projects/[projectId]/services">,
) {
  return withOrg(request, ["owner", "admin", "member"], async (actor) => {
    const { projectId } = await context.params;
    return apiData(await listServices(actor.organizationId, projectId));
  });
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/projects/[projectId]/services">,
) {
  let input: {
    name?: unknown;
    repoUrl?: unknown;
    branch?: unknown;
    dockerfilePath?: unknown;
    containerPort?: unknown;
    healthPath?: unknown;
  };
  try {
    input = (await request.json()) as typeof input;
  } catch {
    return apiError(new ApiError(400, "invalid_body", "Invalid request body."));
  }

  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { projectId } = await context.params;
    const service = await createService({
      organizationId: actor.organizationId,
      projectId,
      name: input.name,
      repoUrl: input.repoUrl,
      branch: input.branch,
      dockerfilePath: input.dockerfilePath,
      containerPort: input.containerPort,
      healthPath: input.healthPath,
    });

    await recordAudit("service.created", actor.organizationId, actor.userId, undefined, {
      projectId: service.projectId,
      serviceId: service.id,
      name: service.name,
      slug: service.slug,
      platformHostname: service.platformHostname,
    });

    return apiData(service, 201);
  } catch (error) {
    return apiError(error);
  }
}
