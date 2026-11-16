import { apiData, apiError } from "@/lib/platform/api";
import { requirePlatformAdmin } from "@/lib/platform/platform-admin";

/**
 * Admin agent catalog — mirrors stealth-forge's `/v1/admin/agent-catalog`.
 * paas runs no hosted agents yet, so the catalog is empty and the execution
 * block reports not-ready with the same message shape the ported Providers
 * page renders.
 */
export async function GET(request: Request) {
  try {
    await requirePlatformAdmin(request.headers);
    return apiData({
      providers: [],
      roles: [],
      tools: [],
      execution: {
        mode: "queue_only",
        ready: false,
        message:
          "Agent execution is not configured on this instance. No agent providers are available.",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
