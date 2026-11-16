import { ApiError } from "@/lib/platform/api-error";
import { apiData, withAdmin } from "@/lib/platform/api";
import { listAbuseReports } from "@/lib/platform/abuse";

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const status = new URL(request.url).searchParams.get("status");
    if (status && !["new", "triaged", "resolved", "dismissed"].includes(status))
      throw new ApiError(400, "invalid_status", "Invalid report status.");
    return apiData(
      await listAbuseReports(status as "new" | "triaged" | "resolved" | "dismissed" | undefined),
    );
  });
}
