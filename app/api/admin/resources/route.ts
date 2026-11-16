import { apiData, apiError, ApiError } from "@/lib/platform/api";
import { requirePlatformAdmin } from "@/lib/platform/platform-admin";
import { listAdminResources } from "@/lib/platform/suspensions";

export async function GET(request: Request) {
  try {
    await requirePlatformAdmin(request.headers);
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 2 || query.length > 100)
      throw new ApiError(400, "invalid_query", "Search must be between 2 and 100 characters.");
    return apiData(await listAdminResources(query));
  } catch (error) {
    return apiError(error);
  }
}
