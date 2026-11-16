import { apiData, apiError } from "@/lib/platform/api";
import { requireOrganizationRole } from "@/lib/platform/organization-management";
import { listOrganizationServices } from "@/lib/platform/services";

export async function GET(request: Request) {
  // Read the headers before the try block. Touching them tells Next this route
  // depends on the request and must not be prerendered; inside the try the
  // bailout signal would be swallowed and turned into a 500 response.
  const headers = request.headers;

  try {
    const actor = await requireOrganizationRole(headers, ["owner", "admin", "member"]);
    return apiData(await listOrganizationServices(actor.organizationId));
  } catch (error) {
    return apiError(error);
  }
}
