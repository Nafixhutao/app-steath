import { apiData, withOrg } from "@/lib/platform/api";
import { getOrganizationUsage, refreshOrganizationUsage } from "@/lib/platform/usage";

/**
 * Organization Quota and usage. Every role may read it. Opening the page forces
 * a fresh measurement, which is the "when the page is opened" half of the
 * five-minute refresh promise; the worker owns the timer.
 */
export async function GET(request: Request) {
  return withOrg(request, ["owner", "admin", "member"], async (actor) => {
    await refreshOrganizationUsage(actor.organizationId);

    return apiData(await getOrganizationUsage(actor.organizationId));
  });
}
