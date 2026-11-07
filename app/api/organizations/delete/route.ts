import {
  deleteOrganizationWithConfirmation,
  organizationErrorResponse,
} from "@/lib/platform/organization-management";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

type DeleteOrganizationInput = {
  organizationId?: string;
  confirmation?: string;
};

export async function POST(request: Request) {
  let input: DeleteOrganizationInput;
  try {
    input = (await request.json()) as DeleteOrganizationInput;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const context = await requireOrganizationRole(request.headers, ["owner"]);
    if (input.organizationId && input.organizationId !== context.organizationId) {
      return Response.json(
        { error: "Only the active Organization can be deleted here" },
        { status: 403 },
      );
    }
    if (typeof input.confirmation !== "string" || !input.confirmation.trim()) {
      return Response.json(
        { error: "Organization name confirmation is required" },
        { status: 400 },
      );
    }
    const deleted = await deleteOrganizationWithConfirmation({
      organizationId: context.organizationId,
      actorUserId: context.userId,
      name: input.confirmation.trim(),
    });
    if (!deleted) {
      return Response.json(
        { error: "Organization name mismatch or owner access required" },
        { status: 403 },
      );
    }
    return Response.json({ success: true });
  } catch (error) {
    return organizationErrorResponse(error);
  }
}
