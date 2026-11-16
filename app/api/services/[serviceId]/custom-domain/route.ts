import { ApiError, apiData, apiError } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import {
  addServiceCustomDomain,
  deleteServiceCustomDomain,
  getServiceCustomDomain,
} from "@/lib/platform/custom-domains";
import { requireOrganizationRole } from "@/lib/platform/organization-management";
import { getService } from "@/lib/platform/services";

type RouteContext = { params: Promise<{ serviceId: string }> };

/**
 * Reads the Service's Custom Domain. Every role may see the hostname and the DNS
 * instructions; only owners and admins may change them.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin", "member"]);
    const { serviceId } = await context.params;
    return apiData(await getServiceCustomDomain(actor.organizationId, serviceId));
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Adds the one Custom Domain a Service may have. It starts `pending`: the owner
 * must publish the TXT record and point DNS at the platform before verification.
 */
export async function POST(request: Request, context: RouteContext) {
  let input: { hostname?: unknown };
  try {
    input = (await request.json()) as { hostname?: unknown };
  } catch {
    return apiError(new ApiError(400, "invalid_body", "Invalid request body."));
  }

  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { serviceId } = await context.params;
    const service = await getService(actor.organizationId, serviceId);
    const domain = await addServiceCustomDomain({
      organizationId: actor.organizationId,
      serviceId,
      hostname: input.hostname,
    });

    await recordAudit(
      "custom_domain.created",
      actor.organizationId,
      actor.userId,
      undefined,
      {
        projectId: service.projectId,
        serviceId,
        domainId: domain.id,
        hostname: domain.hostname,
      },
    );

    return apiData(domain);
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Removes the Custom Domain, its route and its certificate status. The route is
 * removed first: a node that cannot be reached fails the delete so an orphan
 * route can never keep serving a domain the user deleted.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { serviceId } = await context.params;
    const service = await getService(actor.organizationId, serviceId);
    const removed = await deleteServiceCustomDomain({
      organizationId: actor.organizationId,
      serviceId,
    });

    await recordAudit(
      "custom_domain.deleted",
      actor.organizationId,
      actor.userId,
      undefined,
      {
        projectId: service.projectId,
        serviceId,
        domainId: removed.id,
        hostname: removed.hostname,
      },
    );

    return apiData(removed);
  } catch (error) {
    return apiError(error);
  }
}
