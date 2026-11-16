import { ApiError } from "@/lib/platform/api-error";
import { apiData, apiError } from "@/lib/platform/api";
import {
  deleteOrganizationWithConfirmation,
  requireOrganizationRole,
} from "@/lib/platform/organization-management";

type DeleteOrganizationInput = {
  organizationId?: string;
  confirmation?: string;
};

export async function POST(request: Request) {
  let input: DeleteOrganizationInput;
  try {
    input = (await request.json()) as DeleteOrganizationInput;
  } catch {
    return apiError(new ApiError(400, "invalid_body", "Invalid request body."));
  }

  try {
    const context = await requireOrganizationRole(request.headers, ["owner"]);
    if (input.organizationId && input.organizationId !== context.organizationId) {
      return apiError(
        new ApiError(403, "forbidden", "Only the active Organization can be deleted here."),
      );
    }
    if (typeof input.confirmation !== "string" || !input.confirmation.trim()) {
      return apiError(
        new ApiError(400, "invalid_confirmation", "Organization name confirmation is required."),
      );
    }
    const deleted = await deleteOrganizationWithConfirmation({
      organizationId: context.organizationId,
      actorUserId: context.userId,
      name: input.confirmation.trim(),
    });
    if (!deleted) {
      return apiError(
        new ApiError(403, "forbidden", "Organization name mismatch or owner access required."),
      );
    }
    return apiData({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
