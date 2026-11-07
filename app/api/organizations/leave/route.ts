import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { auditPool } from "@/lib/platform/audit";

type LeaveOrganizationInput = {
  organizationId?: string;
};

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

  let input: LeaveOrganizationInput;
  try {
    input = (await request.json()) as LeaveOrganizationInput;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const organizationId = input.organizationId ?? session.session.activeOrganizationId;
  if (!organizationId) return Response.json({ error: "No Organization selected" }, { status: 400 });

  try {
    const member = await auth.api.leaveOrganization({
      headers: request.headers,
      body: { organizationId },
    });

    await auditPool.query(
      `INSERT INTO "audit_event" ("organizationId", "actorUserId", "targetUserId", "action", "details")
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        organizationId,
        session.user.id,
        session.user.id,
        "member.left",
        JSON.stringify({ role: member?.role ?? null }),
      ],
    );

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof APIError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }
}
