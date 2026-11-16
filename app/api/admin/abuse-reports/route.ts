import { apiData, apiError } from "@/lib/platform/api";
import { listAbuseReports } from "@/lib/platform/abuse";
import { requirePlatformAdmin } from "@/lib/platform/platform-admin";
import { ApiError } from "@/lib/platform/api";

export async function GET(request: Request) {
  try {
    await requirePlatformAdmin(request.headers);
    const status = new URL(request.url).searchParams.get("status");
    if (status && !["new", "triaged", "resolved", "dismissed"].includes(status))
      throw new ApiError(400, "invalid_status", "Invalid report status.");
    return apiData(
      await listAbuseReports(status as "new" | "triaged" | "resolved" | "dismissed" | undefined),
    );
  } catch (error) {
    return apiError(error);
  }
}
