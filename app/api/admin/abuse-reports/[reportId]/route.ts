import { apiData, ApiError, readJson, withAdmin } from "@/lib/platform/api";
import { updateAbuseReport } from "@/lib/platform/abuse";
import { recordPlatformAudit } from "@/lib/platform/audit";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/admin/abuse-reports/[reportId]">,
) {
  return withAdmin(request, async (actor) => {
    const { status } = await readJson<{ status?: unknown }>(request);
    if (typeof status !== "string" || !["new", "triaged", "resolved", "dismissed"].includes(status))
      throw new ApiError(400, "invalid_status", "Invalid report status.");
    const { reportId } = await context.params;
    const report = await updateAbuseReport(
      reportId,
      status as "new" | "triaged" | "resolved" | "dismissed",
    );
    await recordPlatformAudit("platform.abuse_report.updated", actor.userId, { reportId, status });
    return apiData(report);
  });
}
