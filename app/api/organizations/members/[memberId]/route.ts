import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { ApiError } from "@/lib/platform/api-error";
import { apiData, apiError, readJson } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { requireOrganizationRole } from "@/lib/platform/organization-management";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/organizations/members/[memberId]">,
) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { memberId } = await context.params;
    const input = await readJson<{ role?: string }>(request);
    if (input.role !== "admin" && input.role !== "member") {
      return apiError(
        new ApiError(400, "invalid_role", "Only admin and member roles can be assigned here."),
      );
    }

    const current = await auth.api.listMembers({
      headers: request.headers,
      query: { organizationId: actor.organizationId },
    });
    const target = current.members.find((member) => member.id === memberId);
    if (!target) return apiError(new ApiError(404, "member_not_found", "Member not found."));
    const actorRoles = actor.role.split(",").map((role) => role.trim());
    const targetRoles = target.role.split(",").map((role) => role.trim());
    if (!actorRoles.includes("owner") && targetRoles.includes("owner")) {
      return apiError(new ApiError(403, "forbidden", "Admins cannot change the owner role."));
    }

    const updated = await auth.api.updateMemberRole({
      headers: request.headers,
      body: { memberId, organizationId: actor.organizationId, role: input.role },
    });
    await recordAudit("member.role_updated", actor.organizationId, actor.userId, target.userId, {
      previousRole: target.role,
      role: input.role,
      memberId,
    });
    return apiData(updated);
  } catch (error) {
    if (error instanceof APIError) {
      return apiError(
        new ApiError(error.statusCode, "organization_operation_failed", error.message),
      );
    }
    return apiError(error);
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/organizations/members/[memberId]">,
) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner"]);
    const { memberId } = await context.params;
    const current = await auth.api.listMembers({
      headers: request.headers,
      query: { organizationId: actor.organizationId },
    });
    const target = current.members.find((member) => member.id === memberId);
    if (!target) return apiError(new ApiError(404, "member_not_found", "Member not found."));

    const removed = await auth.api.removeMember({
      headers: request.headers,
      body: { memberIdOrEmail: target.id, organizationId: actor.organizationId },
    });
    await recordAudit("member.removed", actor.organizationId, actor.userId, target.userId, {
      role: target.role,
      memberId,
    });
    return apiData(removed);
  } catch (error) {
    if (error instanceof APIError) {
      return apiError(
        new ApiError(error.statusCode, "organization_operation_failed", error.message),
      );
    }
    return apiError(error);
  }
}
