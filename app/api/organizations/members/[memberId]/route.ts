import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { recordAudit } from "@/lib/platform/audit";
import {
  organizationErrorResponse,
  requireOrganizationRole,
} from "@/lib/platform/organization-management";

type RouteContext = { params: Promise<{ memberId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { memberId } = await context.params;
    const input = (await request.json()) as { role?: string };
    if (input.role !== "admin" && input.role !== "member") {
      return Response.json(
        { error: "Only admin and member roles can be assigned here" },
        { status: 400 },
      );
    }

    const current = await auth.api.listMembers({
      headers: request.headers,
      query: { organizationId: actor.organizationId },
    });
    const target = current.members.find((member) => member.id === memberId);
    if (!target) return Response.json({ error: "Member not found" }, { status: 404 });
    if (actor.role !== "owner" && target.role === "owner") {
      return Response.json({ error: "Admins cannot change the owner role" }, { status: 403 });
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
    return Response.json(updated);
  } catch (error) {
    if (error instanceof APIError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }
    return organizationErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner"]);
    const { memberId } = await context.params;
    const current = await auth.api.listMembers({
      headers: request.headers,
      query: { organizationId: actor.organizationId },
    });
    const target = current.members.find((member) => member.id === memberId);
    if (!target) return Response.json({ error: "Member not found" }, { status: 404 });

    const removed = await auth.api.removeMember({
      headers: request.headers,
      body: { memberIdOrEmail: target.id, organizationId: actor.organizationId },
    });
    await recordAudit("member.removed", actor.organizationId, actor.userId, target.userId, {
      role: target.role,
      memberId,
    });
    return Response.json(removed);
  } catch (error) {
    if (error instanceof APIError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }
    return organizationErrorResponse(error);
  }
}
