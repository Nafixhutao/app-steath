import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { prepareTestDatabase } from "../helpers/database";

const BASE_URL = "http://localhost:3000";
const PASSWORD = "password-12345";
const RUN_ID = Math.random().toString(36).slice(2, 8);

function uniqueName(base: string): string {
  return `${base}${RUN_ID}`;
}

type Auth = (typeof import("@/lib/auth"))["auth"];

let auth: Auth;

beforeAll(async () => {
  await prepareTestDatabase();
  process.env.BETTER_AUTH_URL = BASE_URL;
  process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-characters-long";

  ({ auth } = await import("@/lib/auth"));
});

type Session = {
  id?: string;
  activeOrganizationId?: string | null;
};

type SignUpResult = {
  cookie: string;
  userId: string;
  organizationId: string;
};

async function signUp(email: string, username: string): Promise<SignUpResult> {
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ email, password: PASSWORD, name: username, username }),
    }),
  );

  expect(response.status).toBe(200);

  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const body = (await response.json()) as { user: { id: string } };
  const session = await getSession(cookie);

  expect(session.session.activeOrganizationId).toBeTruthy();

  return {
    cookie,
    userId: body.user.id,
    organizationId: session.session.activeOrganizationId as string,
  };
}

async function getSession(cookie: string): Promise<{ session: Session; user: { id: string } }> {
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth/get-session`, {
      headers: { cookie, origin: BASE_URL },
    }),
  );

  expect(response.status).toBe(200);

  return (await response.json()) as { session: Session; user: { id: string } };
}

async function organizationRequest(
  cookie: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth/organization/${path}`, {
      method: init.method ?? "GET",
      headers: {
        cookie,
        origin: BASE_URL,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

async function countRows(query: string, values: unknown[]): Promise<number> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query<{ count: string }>(query, values);
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await client.end();
  }
}

async function queryRows<T extends Record<string, unknown>>(
  query: string,
  values: unknown[],
): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query<T>(query, values);
    return result.rows;
  } finally {
    await client.end();
  }
}

/**
 * Resolves the member row id for a user in an Organization via list-members.
 */
async function getMemberId(
  cookie: string,
  organizationId: string,
  userId: string,
): Promise<string> {
  const response = await organizationRequest(
    cookie,
    `list-members?organizationId=${organizationId}`,
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { members: Array<{ id: string; userId: string }> };
  const member = body.members.find((entry) => entry.userId === userId);
  expect(member).toBeTruthy();
  return member!.id;
}

/**
 * Invites an email address from the owner's active Organization and returns
 * the created invitation.
 */
async function invite(
  cookie: string,
  email: string,
  role: "member" | "admin" | "owner" = "member",
): Promise<{ id: string; expiresAt: string; status: string }> {
  const response = await organizationRequest(cookie, "invite-member", {
    method: "POST",
    body: { email, role },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { id: string; expiresAt: string; status: string };
}

describe("Organization invitations and roles", () => {
  it("creates a copyable invitation link that expires after seven days", async () => {
    const owner = await signUp(
      uniqueName("inviteowner") + "@example.test",
      uniqueName("inviteowner"),
    );
    const invitation = await invite(owner.cookie, uniqueName("invitee") + "@example.test");

    expect(invitation.status).toBe("pending");
    expect(invitation.id).toBeTruthy();

    const expiresAt = new Date(invitation.expiresAt).getTime();
    const days = (expiresAt - Date.now()) / (1000 * 60 * 60 * 24);
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7.1);
  });

  it("lets the invited user accept and records the membership as an AuditEvent", async () => {
    const owner = await signUp(
      uniqueName("acceptowner") + "@example.test",
      uniqueName("acceptowner"),
    );
    const inviteeEmail = uniqueName("acceptee") + "@example.test";
    const invitation = await invite(owner.cookie, inviteeEmail);

    const invitee = await signUp(inviteeEmail, uniqueName("acceptee"));
    const accepted = await organizationRequest(invitee.cookie, "accept-invitation", {
      method: "POST",
      body: { invitationId: invitation.id },
    });

    expect(accepted.status).toBe(200);
    const member = (await accepted.json()) as { member: { organizationId: string; role: string } };
    expect(member.member.organizationId).toBe(owner.organizationId);
    expect(member.member.role).toBe("member");

    // Accepting switches the invitee's active Organization to the inviter's.
    const session = await getSession(invitee.cookie);
    expect(session.session.activeOrganizationId).toBe(owner.organizationId);

    const events = await queryRows<{ action: string; targetUserId: string | null }>(
      'SELECT "action", "targetUserId" FROM "audit_event" WHERE "organizationId" = $1 ORDER BY "id"',
      [owner.organizationId],
    );
    expect(events.map((event) => event.action)).toContain("invitation.created");
    expect(events.map((event) => event.action)).toContain("member.joined");
    const joined = events.find((event) => event.action === "member.joined");
    expect(joined?.targetUserId).toBe(invitee.userId);
  });

  it("rejects an expired invitation link", async () => {
    const owner = await signUp(uniqueName("expowner") + "@example.test", uniqueName("expowner"));
    const inviteeEmail = uniqueName("expee") + "@example.test";
    const invitation = await invite(owner.cookie, inviteeEmail);

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(
      'UPDATE "invitation" SET "expiresAt" = now() - interval \'1 hour\' WHERE "id" = $1',
      [invitation.id],
    );
    await client.end();

    const invitee = await signUp(inviteeEmail, uniqueName("expee"));
    const rejected = await organizationRequest(invitee.cookie, "accept-invitation", {
      method: "POST",
      body: { invitationId: invitation.id },
    });

    expect(rejected.status).toBe(400);
    const members = await countRows(
      'SELECT count(*) FROM "member" WHERE "organizationId" = $1 AND "userId" = $2',
      [owner.organizationId, invitee.userId],
    );
    expect(members).toBe(0);
  });

  it("rejects an unknown invitation id", async () => {
    const user = await signUp(uniqueName("badlink") + "@example.test", uniqueName("badlink"));
    const response = await organizationRequest(user.cookie, "accept-invitation", {
      method: "POST",
      body: { invitationId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(response.status).toBe(400);
  });

  it("enforces the owner/admin/member permission matrix", async () => {
    const owner = await signUp(
      uniqueName("matrixowner") + "@example.test",
      uniqueName("matrixowner"),
    );
    const adminEmail = uniqueName("matrixadmin") + "@example.test";
    const memberEmail = uniqueName("matrixmember") + "@example.test";

    const adminInvitation = await invite(owner.cookie, adminEmail, "admin");
    const memberInvitation = await invite(owner.cookie, memberEmail, "member");
    const admin = await signUp(adminEmail, uniqueName("matrixadmin"));
    const member = await signUp(memberEmail, uniqueName("matrixmember"));

    const adminAccepted = await organizationRequest(admin.cookie, "accept-invitation", {
      method: "POST",
      body: { invitationId: adminInvitation.id },
    });
    const memberAccepted = await organizationRequest(member.cookie, "accept-invitation", {
      method: "POST",
      body: { invitationId: memberInvitation.id },
    });
    expect(adminAccepted.status).toBe(200);
    expect(memberAccepted.status).toBe(200);

    // Members cannot invite, remove, update roles, or rename the Organization.
    const memberInvite = await organizationRequest(member.cookie, "invite-member", {
      method: "POST",
      body: { email: uniqueName("blocked") + "@example.test", role: "member" },
    });
    expect(memberInvite.status).toBe(403);

    const memberRemove = await organizationRequest(member.cookie, "remove-member", {
      method: "POST",
      body: { memberIdOrEmail: adminEmail, organizationId: owner.organizationId },
    });
    // Better Auth signals member-management permission violations with 401.
    expect(memberRemove.status).toBe(401);

    const memberRoleUpdate = await organizationRequest(member.cookie, "update-member-role", {
      method: "POST",
      body: {
        memberId: await getMemberId(owner.cookie, owner.organizationId, admin.userId),
        role: "member",
        organizationId: owner.organizationId,
      },
    });
    expect(memberRoleUpdate.status).toBe(403);

    const memberRename = await organizationRequest(member.cookie, "update", {
      method: "POST",
      body: { data: { name: "Hijacked Name" }, organizationId: owner.organizationId },
    });
    expect(memberRename.status).toBe(403);

    // Admins can manage members and invitations but cannot invite an owner.
    const adminInviteMember = await organizationRequest(admin.cookie, "invite-member", {
      method: "POST",
      body: { email: uniqueName("admininvite") + "@example.test", role: "member" },
    });
    expect(adminInviteMember.status).toBe(200);

    const adminInviteOwner = await organizationRequest(admin.cookie, "invite-member", {
      method: "POST",
      body: { email: uniqueName("admininviteowner") + "@example.test", role: "owner" },
    });
    expect(adminInviteOwner.status).toBe(403);

    const { PATCH: updateMemberRoute } =
      await import("@/app/api/organizations/members/[memberId]/route");
    const memberId = await getMemberId(owner.cookie, owner.organizationId, member.userId);
    const adminRoleUpdate = await updateMemberRoute(
      new Request(`${BASE_URL}/api/organizations/members/${memberId}`, {
        method: "PATCH",
        headers: { cookie: admin.cookie, origin: BASE_URL, "content-type": "application/json" },
        body: JSON.stringify({ role: "member" }),
      }),
      { params: Promise.resolve({ memberId }) },
    );
    expect(adminRoleUpdate.status).toBe(200);

    // Admin cannot delete the Organization (owner-only custom route).
    const { POST } = await import("@/app/api/organizations/delete/route");
    const adminDelete = await POST(
      new Request(`${BASE_URL}/api/organizations/delete`, {
        method: "POST",
        headers: { cookie: admin.cookie, origin: BASE_URL, "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "Whatever" }),
      }),
    );
    expect(adminDelete.status).toBe(403);
  });

  it("records an AuditEvent when a member role changes", async () => {
    const owner = await signUp(
      uniqueName("auditowner") + "@example.test",
      uniqueName("auditowner"),
    );
    const memberEmail = uniqueName("auditmember") + "@example.test";
    const invitation = await invite(owner.cookie, memberEmail);
    const member = await signUp(memberEmail, uniqueName("auditmember"));
    await organizationRequest(member.cookie, "accept-invitation", {
      method: "POST",
      body: { invitationId: invitation.id },
    });

    const memberId = await getMemberId(owner.cookie, owner.organizationId, member.userId);
    const { PATCH: updateMemberRoute } =
      await import("@/app/api/organizations/members/[memberId]/route");
    const promoted = await updateMemberRoute(
      new Request(`${BASE_URL}/api/organizations/members/${memberId}`, {
        method: "PATCH",
        headers: { cookie: owner.cookie, origin: BASE_URL, "content-type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      }),
      { params: Promise.resolve({ memberId }) },
    );
    expect(promoted.status).toBe(200);

    const events = await queryRows<{ action: string; details: Record<string, unknown> }>(
      'SELECT "action", "details" FROM "audit_event" WHERE "organizationId" = $1 AND "action" = $2',
      [owner.organizationId, "member.role_updated"],
    );
    expect(events.length).toBe(1);
    expect(events[0].details).toMatchObject({ previousRole: "member", role: "admin" });
  });

  it("lets an owner remove a member and a member leave, and records both", async () => {
    const owner = await signUp(
      uniqueName("removeowner") + "@example.test",
      uniqueName("removeowner"),
    );
    const adminEmail = uniqueName("removeadmin") + "@example.test";
    const memberEmail = uniqueName("removee") + "@example.test";

    const adminInvitation = await invite(owner.cookie, adminEmail);
    const admin = await signUp(adminEmail, uniqueName("removeadmin"));
    await organizationRequest(admin.cookie, "accept-invitation", {
      method: "POST",
      body: { invitationId: adminInvitation.id },
    });
    // Promote the invitee through the audited management route.
    const adminMemberId = await getMemberId(owner.cookie, owner.organizationId, admin.userId);
    const { PATCH: updateMemberRoute } =
      await import("@/app/api/organizations/members/[memberId]/route");
    const adminRoleUpdate = await updateMemberRoute(
      new Request(`${BASE_URL}/api/organizations/members/${adminMemberId}`, {
        method: "PATCH",
        headers: { cookie: owner.cookie, origin: BASE_URL, "content-type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      }),
      { params: Promise.resolve({ memberId: adminMemberId }) },
    );
    expect(adminRoleUpdate.status).toBe(200);

    const memberInvitation = await invite(owner.cookie, memberEmail);
    const member = await signUp(memberEmail, uniqueName("removee"));
    await organizationRequest(member.cookie, "accept-invitation", {
      method: "POST",
      body: { invitationId: memberInvitation.id },
    });

    // Owner removes the ordinary member.
    const memberId = await getMemberId(owner.cookie, owner.organizationId, member.userId);
    const { DELETE: removeMemberRoute } =
      await import("@/app/api/organizations/members/[memberId]/route");
    const removed = await removeMemberRoute(
      new Request(`${BASE_URL}/api/organizations/members/${memberId}`, {
        method: "DELETE",
        headers: { cookie: owner.cookie, origin: BASE_URL },
      }),
      { params: Promise.resolve({ memberId }) },
    );
    expect(removed.status).toBe(200);

    // Admin leaves on their own through the custom audited leave route.
    const { POST: leaveRoute } = await import("@/app/api/organizations/leave/route");
    const left = await leaveRoute(
      new Request(`${BASE_URL}/api/organizations/leave`, {
        method: "POST",
        headers: { cookie: admin.cookie, origin: BASE_URL, "content-type": "application/json" },
        body: JSON.stringify({ organizationId: owner.organizationId }),
      }),
    );
    expect(left.status).toBe(200);

    const remaining = await countRows('SELECT count(*) FROM "member" WHERE "organizationId" = $1', [
      owner.organizationId,
    ]);
    expect(remaining).toBe(1);

    const actions = await queryRows<{ action: string }>(
      'SELECT "action" FROM "audit_event" WHERE "organizationId" = $1 AND "action" IN ($2, $3)',
      [owner.organizationId, "member.removed", "member.left"],
    );
    expect(actions.map((event) => event.action).sort()).toEqual(["member.left", "member.removed"]);
  });

  it("protects the last owner from removal, demotion, and leaving", async () => {
    const owner = await signUp(uniqueName("lastowner") + "@example.test", uniqueName("lastowner"));

    // Leaving as the only owner is rejected (custom audited leave route).
    const { POST: leaveRoute } = await import("@/app/api/organizations/leave/route");
    const leave = await leaveRoute(
      new Request(`${BASE_URL}/api/organizations/leave`, {
        method: "POST",
        headers: { cookie: owner.cookie, origin: BASE_URL, "content-type": "application/json" },
        body: JSON.stringify({ organizationId: owner.organizationId }),
      }),
    );
    expect(leave.status).toBe(400);

    // Removing self as the only owner is rejected.
    const remove = await organizationRequest(owner.cookie, "remove-member", {
      method: "POST",
      body: {
        memberIdOrEmail: uniqueName("lastowner") + "@example.test",
        organizationId: owner.organizationId,
      },
    });
    expect(remove.status).toBe(400);

    // Demoting self as the only owner is rejected.
    const demote = await organizationRequest(owner.cookie, "update-member-role", {
      method: "POST",
      body: {
        memberId: await getMemberId(owner.cookie, owner.organizationId, owner.userId),
        role: "member",
        organizationId: owner.organizationId,
      },
    });
    expect(demote.status).toBe(400);

    // The database guard applies even for direct SQL updates.
    const directDemote = queryRows(
      'UPDATE "member" SET "role" = $1 WHERE "organizationId" = $2 AND "role" = $3',
      ["member", owner.organizationId, "owner"],
    ).catch((error: { message: string }) => error.message);
    await expect(directDemote).resolves.toContain("last Organization owner");

    const owners = await countRows(
      'SELECT count(*) FROM "member" WHERE "organizationId" = $1 AND "role" = $2',
      [owner.organizationId, "owner"],
    );
    expect(owners).toBe(1);
  });

  it("deletes an Organization with the exact name and rejects other confirmations", async () => {
    const owner = await signUp(uniqueName("delowner") + "@example.test", uniqueName("delowner"));
    const memberEmail = uniqueName("delee") + "@example.test";
    const invitation = await invite(owner.cookie, memberEmail);
    const member = await signUp(memberEmail, uniqueName("delee"));
    await organizationRequest(member.cookie, "accept-invitation", {
      method: "POST",
      body: { invitationId: invitation.id },
    });

    const session = await getSession(owner.cookie);
    const organizations = await queryRows<{ name: string }>(
      'SELECT "name" FROM "organization" WHERE "id" = $1',
      [owner.organizationId],
    );
    const organizationName = organizations[0].name;

    const { POST } = await import("@/app/api/organizations/delete/route");
    function deleteRequest(cookie: string, body: unknown) {
      return new Request(`${BASE_URL}/api/organizations/delete`, {
        method: "POST",
        headers: { cookie, origin: BASE_URL, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    // Member cannot delete.
    const memberDelete = await POST(
      deleteRequest(member.cookie, { confirmation: organizationName }),
    );
    expect(memberDelete.status).toBe(403);

    // Wrong confirmation is rejected.
    const wrongDelete = await POST(deleteRequest(owner.cookie, { confirmation: "Wrong Name" }));
    expect(wrongDelete.status).toBe(403);

    // Missing confirmation is rejected.
    const missingDelete = await POST(deleteRequest(owner.cookie, { confirmation: "" }));
    expect(missingDelete.status).toBe(400);

    // Correct confirmation deletes the Organization and its membership.
    const deleted = await POST(deleteRequest(owner.cookie, { confirmation: organizationName }));
    expect(deleted.status).toBe(200);

    const organizationCount = await countRows(
      'SELECT count(*) FROM "organization" WHERE "id" = $1',
      [owner.organizationId],
    );
    expect(organizationCount).toBe(0);

    const memberCount = await countRows(
      'SELECT count(*) FROM "member" WHERE "organizationId" = $1',
      [owner.organizationId],
    );
    expect(memberCount).toBe(0);

    const activeAfterDelete = await getSession(owner.cookie);
    expect(activeAfterDelete.session.activeOrganizationId).toBeNull();
    expect(session.session.id).toBeTruthy();
  });
});
