import { apiData, apiError } from "@/lib/platform/api";
import { requirePlatformAdmin } from "@/lib/platform/platform-admin";

/**
 * Admin trace spans — mirrors stealth-forge's `/v1/admin/telemetry/traces`.
 * paas has no OTLP collector yet, so the honest answer is an empty list: the
 * ported Traces page renders its real empty state instead of fabricated data.
 * When a collector is added, this endpoint answers from it in the same shape.
 */
export async function GET(request: Request) {
  try {
    await requirePlatformAdmin(request.headers);
    return apiData({ items: [] });
  } catch (error) {
    return apiError(error);
  }
}
