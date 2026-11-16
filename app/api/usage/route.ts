import { apiData, apiError } from "@/lib/platform/api";
import { requireOrganizationRole } from "@/lib/platform/organization-management";
import { getOrganizationUsage, refreshOrganizationUsage } from "@/lib/platform/usage";

/**
 * Organization Quota and usage. Every role may read it. Opening the page forces
 * a fresh measurement, which is the "when the page is opened" half of the
 * five-minute refresh promise; the worker owns the timer.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin", "member"]);

    await refreshOrganizationUsage(actor.organizationId);

    return apiData(await getOrganizationUsage(actor.organizationId));
  } catch (error) {
    return apiError(error);
  }
}
