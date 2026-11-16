import { apiData, apiError } from "@/lib/platform/api";
import { getPlatformAdminStatus } from "@/lib/platform/platform-admin";

/**
 * Reports whether the signed-in user is a Platform Admin. The sidebar calls this
 * to decide whether to show the Admin link, so an anonymous visitor gets `false`
 * rather than an error.
 */
export async function GET(request: Request) {
  try {
    const platformAdmin = await getPlatformAdminStatus(request.headers);

    return apiData({ platformAdmin });
  } catch (error) {
    return apiError(error);
  }
}
