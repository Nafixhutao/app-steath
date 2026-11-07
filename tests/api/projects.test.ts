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

  return {
    cookie,
    userId: body.user.id,
    organizationId: session.session.activeOrganizationId as string,
  };
}

async function getSession(
  cookie: string,
): Promise<{ session: { activeOrganizationId: string | null } }> {
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth/get-session`, {
      headers: { cookie, origin: BASE_URL },
    }),
  );

  expect(response.status).toBe(200);
  return (await response.json()) as { session: { activeOrganizationId: string | null } };
}

/**
 * Invites a user into the owner's Organization and accepts on their behalf, so
 * the returned cookie acts with the requested Role.
 */
async function addMember(
  ownerCookie: string,
  organizationId: string,
  role: "admin" | "member",
): Promise<SignUpResult> {
  const email = uniqueName(`proj${role}`) + "@example.test";
  const inviteResponse = await auth.handler(
    new Request(`${BASE_URL}/api/auth/organization/invite-member`, {
      method: "POST",
      headers: { cookie: ownerCookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    }),
  );
  expect(inviteResponse.status).toBe(200);
  const invitation = (await inviteResponse.json()) as { id: string };

  const member = await signUp(email, uniqueName(`proj${role}`));
  const accepted = await auth.handler(
    new Request(`${BASE_URL}/api/auth/organization/accept-invitation`, {
      method: "POST",
      headers: { cookie: member.cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ invitationId: invitation.id }),
    }),
  );
  expect(accepted.status).toBe(200);

  const session = await getSession(member.cookie);
  expect(session.session.activeOrganizationId).toBe(organizationId);

  return member;
}

type ProjectBody = {
  id: string;
  name: string;
  slug: string;
  serviceCount: number;
  databaseCount: number;
  status: string;
};

type ProjectListBody = { data: ProjectBody[] };
type ProjectItemBody = { data: ProjectBody };
type FailureBody = {
  error: { code: string; message: string; details?: { limit?: number; usage?: number } };
};

async function projectRequest(
  cookie: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const { GET, POST } = await import("@/app/api/projects/route");
  const { GET: GET_ONE, PATCH, DELETE } = await import("@/app/api/projects/[projectId]/route");
  const url = new URL(`${BASE_URL}/api/projects${path}`);
  const request = new Request(url, {
    method: init.method ?? "GET",
    headers: {
      cookie,
      origin: BASE_URL,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (path === "" && (init.method ?? "GET") === "GET") return GET(request);
  if (path === "" && init.method === "POST") return POST(request);

  const projectId = path.replace(/^\//, "");
  const context = { params: Promise.resolve({ projectId }) };
  if ((init.method ?? "GET") === "GET") return GET_ONE(request, context);
  if (init.method === "PATCH") return PATCH(request, context);
  return DELETE(request, context);
}

async function createProject(cookie: string, name: string, slug?: string): Promise<ProjectBody> {
  const response = await projectRequest(cookie, "", {
    method: "POST",
    body: slug === undefined ? { name } : { name, slug },
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as ProjectItemBody).data;
}

async function queryRows<T extends Record<string, unknown>>(
  query: string,
  values: unknown[],
): Promise<T[]> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query<T>(query, values);
    return result.rows;
  } finally {
    await client.end();
  }
}

describe("Project lifecycle", () => {
  it("creates a Project with a slug that is unique per Organization", async () => {
    const owner = await signUp(uniqueName("slugowner") + "@example.test", uniqueName("slugowner"));

    const first = await createProject(owner.cookie, "Marketing Site");
    expect(first.name).toBe("Marketing Site");
    expect(first.slug).toBe("marketing-site");

    // A different Organization may reuse the same slug.
    const other = await signUp(uniqueName("slugother") + "@example.test", uniqueName("slugother"));
    const otherProject = await createProject(other.cookie, "Marketing Site");
    expect(otherProject.slug).toBe("marketing-site");

    // The same Organization may not.
    const duplicate = await projectRequest(owner.cookie, "", {
      method: "POST",
      body: { name: "Another Site", slug: "marketing-site" },
    });
    expect(duplicate.status).toBe(409);
    const body = (await duplicate.json()) as FailureBody;
    expect(body.error.code).toBe("project_slug_taken");
  });

  it("lists Projects with Service and Database counts and a summary status", async () => {
    const owner = await signUp(uniqueName("listowner") + "@example.test", uniqueName("listowner"));
    await createProject(owner.cookie, "Alpha App");

    const response = await projectRequest(owner.cookie, "");
    expect(response.status).toBe(200);
    const body = (await response.json()) as ProjectListBody;

    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      name: "Alpha App",
      slug: "alpha-app",
      serviceCount: 0,
      databaseCount: 0,
      status: "empty",
    });

    const detail = await projectRequest(owner.cookie, `/${body.data[0].id}`);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as ProjectItemBody).data.slug).toBe("alpha-app");
  });

  it("lets owners and admins rename a Project and change its slug", async () => {
    const owner = await signUp(
      uniqueName("renameowner") + "@example.test",
      uniqueName("renameowner"),
    );
    const admin = await addMember(owner.cookie, owner.organizationId, "admin");
    const project = await createProject(owner.cookie, "Original Name");

    const renamed = await projectRequest(owner.cookie, `/${project.id}`, {
      method: "PATCH",
      body: { name: "Renamed Project", slug: "renamed-project" },
    });
    expect(renamed.status).toBe(200);
    const updated = ((await renamed.json()) as ProjectItemBody).data;
    expect(updated.name).toBe("Renamed Project");
    expect(updated.slug).toBe("renamed-project");

    const adminRename = await projectRequest(admin.cookie, `/${project.id}`, {
      method: "PATCH",
      body: { name: "Admin Renamed" },
    });
    expect(adminRename.status).toBe(200);
    expect(((await adminRename.json()) as ProjectItemBody).data.name).toBe("Admin Renamed");
  });

  it("rejects invalid names and slugs", async () => {
    const owner = await signUp(
      uniqueName("invalidowner") + "@example.test",
      uniqueName("invalidowner"),
    );

    const emptyName = await projectRequest(owner.cookie, "", {
      method: "POST",
      body: { name: "  " },
    });
    expect(emptyName.status).toBe(400);

    const badSlug = await projectRequest(owner.cookie, "", {
      method: "POST",
      body: { name: "Bad Slug", slug: "Not A Slug!" },
    });
    expect(badSlug.status).toBe(400);
    expect(((await badSlug.json()) as FailureBody).error.code).toBe("invalid_project_slug");
  });

  it("rejects the fourth Project with a Quota error that names the limit and usage", async () => {
    const owner = await signUp(
      uniqueName("quotaowner") + "@example.test",
      uniqueName("quotaowner"),
    );

    await createProject(owner.cookie, "Project One");
    await createProject(owner.cookie, "Project Two");
    await createProject(owner.cookie, "Project Three");

    const fourth = await projectRequest(owner.cookie, "", {
      method: "POST",
      body: { name: "Project Four" },
    });

    expect(fourth.status).toBe(409);
    const body = (await fourth.json()) as FailureBody;
    expect(body.error.code).toBe("quota_exceeded");
    expect(body.error.details).toMatchObject({ limit: 3, usage: 3 });
    expect(body.error.message).toContain("3");
    expect(body.error.message).toMatch(/quota/i);

    const remaining = await projectRequest(owner.cookie, "");
    expect(((await remaining.json()) as ProjectListBody).data).toHaveLength(3);
  });

  it("keeps members read-only", async () => {
    const owner = await signUp(
      uniqueName("memberowner") + "@example.test",
      uniqueName("memberowner"),
    );
    const member = await addMember(owner.cookie, owner.organizationId, "member");
    const project = await createProject(owner.cookie, "Shared Project");

    // Members can read.
    const list = await projectRequest(member.cookie, "");
    expect(list.status).toBe(200);
    expect(((await list.json()) as ProjectListBody).data).toHaveLength(1);

    const detail = await projectRequest(member.cookie, `/${project.id}`);
    expect(detail.status).toBe(200);

    // Members cannot create, rename, or delete.
    const create = await projectRequest(member.cookie, "", {
      method: "POST",
      body: { name: "Member Project" },
    });
    expect(create.status).toBe(403);

    const rename = await projectRequest(member.cookie, `/${project.id}`, {
      method: "PATCH",
      body: { name: "Member Rename" },
    });
    expect(rename.status).toBe(403);

    const remove = await projectRequest(member.cookie, `/${project.id}`, {
      method: "DELETE",
      body: { confirmation: "Shared Project" },
    });
    expect(remove.status).toBe(403);
  });

  it("deletes a Project only with the exact name and records an AuditEvent", async () => {
    const owner = await signUp(
      uniqueName("deleteowner") + "@example.test",
      uniqueName("deleteowner"),
    );
    const project = await createProject(owner.cookie, "Doomed Project");

    const missing = await projectRequest(owner.cookie, `/${project.id}`, {
      method: "DELETE",
      body: { confirmation: "" },
    });
    expect(missing.status).toBe(400);

    const wrong = await projectRequest(owner.cookie, `/${project.id}`, {
      method: "DELETE",
      body: { confirmation: "Wrong Name" },
    });
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as FailureBody).error.code).toBe("confirmation_mismatch");

    const deleted = await projectRequest(owner.cookie, `/${project.id}`, {
      method: "DELETE",
      body: { confirmation: "Doomed Project" },
    });
    expect(deleted.status).toBe(200);

    const after = await projectRequest(owner.cookie, `/${project.id}`);
    expect(after.status).toBe(404);

    const events = await queryRows<{ action: string; details: Record<string, unknown> }>(
      'SELECT "action", "details" FROM "audit_event" WHERE "organizationId" = $1 AND "action" LIKE $2 ORDER BY "id"',
      [owner.organizationId, "project.%"],
    );
    expect(events.map((event) => event.action)).toEqual(["project.created", "project.deleted"]);
    expect(events[1].details).toMatchObject({ projectId: project.id, name: "Doomed Project" });
  });

  it("isolates Projects between Organizations", async () => {
    const first = await signUp(uniqueName("tenanta") + "@example.test", uniqueName("tenanta"));
    const second = await signUp(uniqueName("tenantb") + "@example.test", uniqueName("tenantb"));
    const project = await createProject(first.cookie, "Tenant A Project");

    // The other tenant cannot read, rename, or delete it.
    const read = await projectRequest(second.cookie, `/${project.id}`);
    expect(read.status).toBe(404);

    const rename = await projectRequest(second.cookie, `/${project.id}`, {
      method: "PATCH",
      body: { name: "Stolen" },
    });
    expect(rename.status).toBe(404);

    const remove = await projectRequest(second.cookie, `/${project.id}`, {
      method: "DELETE",
      body: { confirmation: "Tenant A Project" },
    });
    expect(remove.status).toBe(404);

    // The list only contains the second tenant's own Projects.
    const list = await projectRequest(second.cookie, "");
    expect(((await list.json()) as ProjectListBody).data).toHaveLength(0);
  });

  it("requires authentication", async () => {
    const { GET } = await import("@/app/api/projects/route");
    const response = await GET(
      new Request(`${BASE_URL}/api/projects`, { headers: { origin: BASE_URL } }),
    );
    expect(response.status).toBe(401);
    expect(((await response.json()) as FailureBody).error.code).toBe("unauthenticated");
  });
});
