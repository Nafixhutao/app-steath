import { apiData, withOrg } from "@/lib/platform/api";
import { listOrganizationDatabases } from "@/lib/platform/databases";

export async function GET(request: Request) {
  // Read the headers before the handler. Touching them tells Next this route
  // depends on the request and must not be prerendered; inside the handler the
  // bailout signal would be swallowed and turned into a 500 response.
  const headers = request.headers;

  return withOrg({ headers } as Request, ["owner", "admin", "member"], async (actor) => {
    return apiData(await listOrganizationDatabases(actor.organizationId, actor.role !== "member"));
  });
}
