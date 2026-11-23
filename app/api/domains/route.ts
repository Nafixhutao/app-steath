import { apiData, withOrg } from "@/lib/platform/api";
import { listOrganizationCustomDomains } from "@/lib/platform/custom-domains";

export async function GET(request: Request) {
  const headers = request.headers;
  return withOrg({ headers } as Request, ["owner", "admin", "member"], async (actor) => {
    return apiData(await listOrganizationCustomDomains(actor.organizationId));
  });
}
