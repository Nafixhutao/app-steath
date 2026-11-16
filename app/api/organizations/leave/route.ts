import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { ApiError } from "@/lib/platform/api-error";
import { apiData, apiError } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";

type LeaveOrganizationInput = {
  organizationId?: string;
};

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return apiError(new ApiError(401, "unauthenticated", "Authentication required."));
  }

  let input: LeaveOrganizationInput;
  try {
    input = (await request.json()) as LeaveOrganizationInput;
  } catch {
    return apiError(new ApiError(400, "invalid_body", "Invalid request body."));
  }

  const organizationId = input.organizationId ?? session.session.activeOrganizationId;
  if (!organizationId) {
    return apiError(new ApiError(400, "invalid_organization", "No Organization selected."));
  }

  try {
    const member = await auth.api.leaveOrganization({
      headers: request.headers,
      body: { organizationId },
    });

    await recordAudit("member.left", organizationId, session.user.id, session.user.id, {
      role: member?.role ?? null,
    });

    return apiData(null);
  } catch (error) {
    if (error instanceof APIError) {
      return apiError(
        new ApiError(error.statusCode, "organization_operation_failed", error.message),
      );
    }
    return apiError(error);
  }
}
