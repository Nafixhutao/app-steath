import { apiData, withOrg } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { verifyServiceCustomDomain } from "@/lib/platform/custom-domains";
import { getService } from "@/lib/platform/services";

/**
 * Checks the TXT record and DNS resolution, then routes the hostname when they
 * match. A failed check is recorded on the domain and returned with 200, so the
 * dashboard can show the reason without treating it as a server error.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/services/[serviceId]/custom-domain/verify">,
) {
  return withOrg(request, ["owner", "admin"], async (actor) => {
    const { serviceId } = await context.params;
    const service = await getService(actor.organizationId, serviceId);
    const domain = await verifyServiceCustomDomain({
      organizationId: actor.organizationId,
      serviceId,
    });

    await recordAudit(
      domain.status === "active" ? "custom_domain.verified" : "custom_domain.verification_failed",
      actor.organizationId,
      actor.userId,
      undefined,
      {
        projectId: service.projectId,
        serviceId,
        domainId: domain.id,
        hostname: domain.hostname,
        status: domain.status,
        ...(domain.lastError ? { error: domain.lastError } : {}),
      },
    );

    return apiData(domain);
  });
}
