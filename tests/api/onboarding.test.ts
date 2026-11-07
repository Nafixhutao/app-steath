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

describe("Organization-first onboarding", () => {
  it("creates a personal Organization and owner membership during signup", async () => {
    const username = uniqueName("ownera");
    const signup = await signUp(`${username}@example.test`, username);
    const organizations = await countRows('SELECT count(*) FROM "organization" WHERE "id" = $1', [
      signup.organizationId,
    ]);
    const owners = await countRows(
      'SELECT count(*) FROM "member" WHERE "organizationId" = $1 AND "userId" = $2 AND "role" = $3',
      [signup.organizationId, signup.userId, "owner"],
    );

    expect(organizations).toBe(1);
    expect(owners).toBe(1);

    const org = await organizationRequest(signup.cookie, "get-full-organization");
    expect(org.status).toBe(200);
    await expect(org.json()).resolves.toMatchObject({
      name: expect.stringContaining(username),
    });
  });

  it("lets a User create another Organization and switch the active one", async () => {
    const signup = await signUp(uniqueName("ownerb") + "@example.test", uniqueName("ownerb"));
    const created = await organizationRequest(signup.cookie, "create", {
      method: "POST",
      body: { name: "Second Workspace", slug: uniqueName("second-workspace") },
    });

    expect(created.status).toBe(200);
    const second = (await created.json()) as { id: string };
    let session = await getSession(signup.cookie);
    expect(session.session.activeOrganizationId).toBe(second.id);

    const switched = await organizationRequest(signup.cookie, "set-active", {
      method: "POST",
      body: { organizationId: signup.organizationId },
    });

    expect(switched.status).toBe(200);
    session = await getSession(signup.cookie);
    expect(session.session.activeOrganizationId).toBe(signup.organizationId);
  });

  it("does not let a User read or activate another tenant's Organization", async () => {
    const tenantA = await signUp(uniqueName("tenanta") + "@example.test", uniqueName("tenanta"));
    const tenantB = await signUp(uniqueName("tenantb") + "@example.test", uniqueName("tenantb"));

    const foreignRead = await organizationRequest(
      tenantB.cookie,
      `get-full-organization?organizationId=${tenantA.organizationId}`,
    );
    expect(foreignRead.status).toBe(403);

    const foreignSwitch = await organizationRequest(tenantB.cookie, "set-active", {
      method: "POST",
      body: { organizationId: tenantA.organizationId },
    });
    expect(foreignSwitch.status).toBe(403);

    const listed = await organizationRequest(tenantB.cookie, "list");
    expect(listed.status).toBe(200);

    const organizations = (await listed.json()) as Array<{ id: string }>;
    expect(organizations.map((organization) => organization.id)).toEqual([tenantB.organizationId]);
  });

  it("provides only a verified active Organization context to resource handlers", async () => {
    const signup = await signUp(uniqueName("guarduser") + "@example.test", uniqueName("guarduser"));
    const { requireActiveOrganization } = await import("@/lib/platform/tenant");
    const context = await requireActiveOrganization(
      new Headers({ cookie: signup.cookie, origin: BASE_URL }),
    );

    expect(context).toMatchObject({
      userId: signup.userId,
      organizationId: signup.organizationId,
      role: "owner",
    });

    await expect(
      requireActiveOrganization(new Headers({ origin: BASE_URL })),
    ).rejects.toMatchObject({
      name: "TenantAccessError",
      status: 401,
    });
  });
});
