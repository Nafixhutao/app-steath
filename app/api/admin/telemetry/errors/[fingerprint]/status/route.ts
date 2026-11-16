import { ApiError, apiData, apiError } from "@/lib/platform/api";
import { requirePlatformAdmin } from "@/lib/platform/platform-admin";

/**
 * Admin error group status — mirrors stealth-forge's
 * `/v1/admin/telemetry/errors/{fingerprint}/status`. Groups are derived from
 * failed deployments and jobs, so there is no row to persist a lifecycle
 * status on yet; the endpoint validates and acknowledges the transition, and
 * the UI keeps its optimistic value until a store exists.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ fingerprint: string }> },
) {
  try {
    await requirePlatformAdmin(request.headers);
    const { fingerprint } = await context.params;
    if (!fingerprint) {
      throw new ApiError(422, "validation_error", "fingerprint is required.");
    }
    const body = (await request.json().catch(() => null)) as {
      status?: string;
    } | null;
    const valid = new Set(["open", "acknowledged", "resolved", "ignored"]);
    if (!body || !valid.has(body.status ?? "")) {
      throw new ApiError(422, "validation_error", "status is invalid.");
    }
    return apiData({ group: { fingerprint, status: body.status } });
  } catch (error) {
    return apiError(error);
  }
}
