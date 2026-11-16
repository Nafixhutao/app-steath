import { apiData, apiError, ApiError } from "@/lib/platform/api";
import { updateAbuseReport } from "@/lib/platform/abuse";
import { requirePlatformAdmin } from "@/lib/platform/platform-admin";
import { recordPlatformAudit } from "@/lib/platform/audit";

type Context = { params: Promise<{ reportId: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await requirePlatformAdmin(request.headers);
    const { status } = (await request.json()) as { status?: unknown };
    if (typeof status !== "string" || !["new", "triaged", "resolved", "dismissed"].includes(status))
      throw new ApiError(400, "invalid_status", "Invalid report status.");
    const { reportId } = await context.params;
    const report = await updateAbuseReport(
      reportId,
      status as "new" | "triaged" | "resolved" | "dismissed",
    );
    await recordPlatformAudit("platform.abuse_report.updated", actor.userId, { reportId, status });
    return apiData(report);
  } catch (error) {
    return apiError(error);
  }
}
