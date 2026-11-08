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
  const email = uniqueName(`svc${role}`) + Math.random().toString(36).slice(2, 6) + "@example.test";
  const inviteResponse = await auth.handler(
    new Request(`${BASE_URL}/api/auth/organization/invite-member`, {
      method: "POST",
      headers: { cookie: ownerCookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    }),
  );
  expect(inviteResponse.status).toBe(200);
  const invitation = (await inviteResponse.json()) as { id: string };

  const member = await signUp(email, uniqueName(`svc${role}`));
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

type ProjectBody = { id: string; name: string; serviceCount: number; status: string };

type ServiceBody = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  repoUrl: string;
  branch: string;
  dockerfilePath: string;
  containerPort: number;
  healthPath: string | null;
  status: string;
  platformHostname: string;
  url: string;
  cpuLimit: number;
  memoryLimitMb: number;
};

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
  const request = new Request(new URL(`${BASE_URL}/api/projects${path}`), {
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

async function createProject(cookie: string, name: string): Promise<ProjectBody> {
  const response = await projectRequest(cookie, "", { method: "POST", body: { name } });
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: ProjectBody }).data;
}

type ServiceTarget = { projectId?: string; serviceId?: string; organization?: true };

/**
 * Dispatches to the Service route handlers directly, mirroring how the dashboard
 * calls them over HTTP.
 */
async function serviceRequest(
  cookie: string,
  target: ServiceTarget,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const method = init.method ?? "GET";
  const request = new Request(new URL(`${BASE_URL}/api/services`), {
    method,
    headers: {
      cookie,
      origin: BASE_URL,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (target.organization) {
    const { GET } = await import("@/app/api/services/route");
    return GET(request);
  }

  if (target.projectId) {
    const { GET, POST } = await import("@/app/api/projects/[projectId]/services/route");
    const context = { params: Promise.resolve({ projectId: target.projectId }) };
    return method === "POST" ? POST(request, context) : GET(request, context);
  }

  const { GET, DELETE } = await import("@/app/api/services/[serviceId]/route");
  const context = { params: Promise.resolve({ serviceId: target.serviceId as string }) };
  return method === "DELETE" ? DELETE(request, context) : GET(request, context);
}

const REPO_URL = "https://github.com/example/web-app";

async function createService(
  cookie: string,
  projectId: string,
  overrides: Record<string, unknown> = {},
): Promise<ServiceBody> {
  const response = await serviceRequest(
    cookie,
    { projectId },
    { method: "POST", body: { name: "Web App", repoUrl: REPO_URL, ...overrides } },
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: ServiceBody }).data;
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

describe("Service configuration", () => {
  it("creates a Service with validated configuration and a Platform Subdomain", async () => {
    const owner = await signUp(uniqueName("svcowner") + "@example.test", uniqueName("svcowner"));
    const project = await createProject(owner.cookie, "Storefront");

    const service = await createService(owner.cookie, project.id, {
      name: "Storefront API",
      branch: "release/2026",
      dockerfilePath: "apps/api/Dockerfile",
      containerPort: 8080,
      healthPath: "/healthz",
    });

    expect(service).toMatchObject({
      projectId: project.id,
      name: "Storefront API",
      slug: "storefront-api",
      repoUrl: "https://github.com/example/web-app",
      branch: "release/2026",
      dockerfilePath: "apps/api/Dockerfile",
      containerPort: 8080,
      healthPath: "/healthz",
      status: "not_deployed",
      cpuLimit: 0.5,
      memoryLimitMb: 512,
    });

    // `<service-slug>-<short-id>.<platform-suffix>`.
    expect(service.platformHostname).toMatch(/^storefront-api-[a-z0-9]{6}\.localhost$/);
    expect(service.url).toBe(`http://${service.platformHostname}`);

    // Defaults apply when optional configuration is omitted.
    const defaults = await createService(owner.cookie, project.id, { name: "Worker" });
    expect(defaults).toMatchObject({
      branch: "main",
      dockerfilePath: "Dockerfile",
      containerPort: 3000,
      healthPath: null,
    });
  });

  it("keeps Platform Subdomains unique even for identically named Services", async () => {
    const first = await signUp(uniqueName("hosta") + "@example.test", uniqueName("hosta"));
    const second = await signUp(uniqueName("hostb") + "@example.test", uniqueName("hostb"));
    const firstProject = await createProject(first.cookie, "Alpha");
    const secondProject = await createProject(second.cookie, "Alpha");

    const firstService = await createService(first.cookie, firstProject.id, { name: "Web App" });
    const secondService = await createService(second.cookie, secondProject.id, { name: "Web App" });

    expect(firstService.platformHostname).not.toBe(secondService.platformHostname);
    expect(firstService.slug).toBe(secondService.slug);

    const rows = await queryRows<{ count: string }>(
      'SELECT count(*) FROM "service" WHERE "platformHostname" = $1',
      [firstService.platformHostname],
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it("rejects repository URLs that are not public HTTPS", async () => {
    const owner = await signUp(uniqueName("repowner") + "@example.test", uniqueName("repowner"));
    const project = await createProject(owner.cookie, "Validation");

    const invalid = [
      "http://github.com/example/web-app",
      "git@github.com:example/web-app.git",
      "https://localhost/app",
      "https://user:secret@github.com/example/web-app",
      "not a url",
      "",
    ];

    for (const repoUrl of invalid) {
      const response = await serviceRequest(
        owner.cookie,
        { projectId: project.id },
        { method: "POST", body: { name: "Bad Repo", repoUrl } },
      );
      expect(response.status, repoUrl).toBe(400);
      expect(((await response.json()) as FailureBody).error.code).toBe("invalid_repo_url");
    }
  });

  it("rejects invalid branch, Dockerfile path, port, and health path", async () => {
    const owner = await signUp(uniqueName("cfgguard") + "@example.test", uniqueName("cfgguard"));
    const project = await createProject(owner.cookie, "Config Guard");

    const cases: Array<{ body: Record<string, unknown>; code: string }> = [
      { body: { branch: "feature branch" }, code: "invalid_branch" },
      { body: { branch: "../main" }, code: "invalid_branch" },
      { body: { dockerfilePath: "/etc/Dockerfile" }, code: "invalid_dockerfile_path" },
      { body: { dockerfilePath: "../Dockerfile" }, code: "invalid_dockerfile_path" },
      { body: { containerPort: 0 }, code: "invalid_container_port" },
      { body: { containerPort: 70000 }, code: "invalid_container_port" },
      { body: { containerPort: "eighty" }, code: "invalid_container_port" },
      { body: { healthPath: "health" }, code: "invalid_health_path" },
      { body: { name: "   " }, code: "invalid_service_name" },
    ];

    for (const testCase of cases) {
      const response = await serviceRequest(
        owner.cookie,
        { projectId: project.id },
        { method: "POST", body: { name: "Web App", repoUrl: REPO_URL, ...testCase.body } },
      );
      expect(response.status, JSON.stringify(testCase.body)).toBe(400);
      expect(((await response.json()) as FailureBody).error.code).toBe(testCase.code);
    }
  });

  it("rejects the third Service in a Project with a Quota error", async () => {
    const owner = await signUp(uniqueName("projquota") + "@example.test", uniqueName("projquota"));
    const project = await createProject(owner.cookie, "Crowded");

    await createService(owner.cookie, project.id, { name: "First" });
    await createService(owner.cookie, project.id, { name: "Second" });

    const third = await serviceRequest(
      owner.cookie,
      { projectId: project.id },
      { method: "POST", body: { name: "Third", repoUrl: REPO_URL } },
    );

    expect(third.status).toBe(409);
    const body = (await third.json()) as FailureBody;
    expect(body.error.code).toBe("quota_exceeded");
    expect(body.error.details).toMatchObject({ limit: 2, usage: 2, scope: "project" });
    expect(body.error.message).toMatch(/quota/i);
  });

  it("rejects the sixth Service in an Organization with a Quota error", async () => {
    const owner = await signUp(uniqueName("orgquota") + "@example.test", uniqueName("orgquota"));
    const projects = [
      await createProject(owner.cookie, "One"),
      await createProject(owner.cookie, "Two"),
      await createProject(owner.cookie, "Three"),
    ];

    await createService(owner.cookie, projects[0].id, { name: "One A" });
    await createService(owner.cookie, projects[0].id, { name: "One B" });
    await createService(owner.cookie, projects[1].id, { name: "Two A" });
    await createService(owner.cookie, projects[1].id, { name: "Two B" });
    await createService(owner.cookie, projects[2].id, { name: "Three A" });

    const sixth = await serviceRequest(
      owner.cookie,
      { projectId: projects[2].id },
      { method: "POST", body: { name: "Three B", repoUrl: REPO_URL } },
    );

    expect(sixth.status).toBe(409);
    const body = (await sixth.json()) as FailureBody;
    expect(body.error.code).toBe("quota_exceeded");
    expect(body.error.details).toMatchObject({ limit: 5, usage: 5, scope: "organization" });
  });

  it("lists Services with status, URL, and resource limits and counts them on the Project", async () => {
    const owner = await signUp(uniqueName("svclist") + "@example.test", uniqueName("svclist"));
    const project = await createProject(owner.cookie, "Listed");
    const service = await createService(owner.cookie, project.id);

    const list = await serviceRequest(owner.cookie, { projectId: project.id });
    expect(list.status).toBe(200);
    const services = ((await list.json()) as { data: ServiceBody[] }).data;
    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({
      id: service.id,
      status: "not_deployed",
      url: service.url,
      cpuLimit: 0.5,
      memoryLimitMb: 512,
    });

    const detail = await serviceRequest(owner.cookie, { serviceId: service.id });
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { data: ServiceBody }).data.platformHostname).toBe(
      service.platformHostname,
    );

    const projectDetail = await projectRequest(owner.cookie, `/${project.id}`);
    const projectBody = ((await projectDetail.json()) as { data: ProjectBody }).data;
    expect(projectBody.serviceCount).toBe(1);
    expect(projectBody.status).toBe("active");

    // The Organization-wide list powers the Services page.
    const organizationList = await serviceRequest(owner.cookie, { organization: true });
    expect(organizationList.status).toBe(200);
    const organizationServices = (
      (await organizationList.json()) as { data: Array<ServiceBody & { projectName: string }> }
    ).data;
    expect(organizationServices).toHaveLength(1);
    expect(organizationServices[0]).toMatchObject({
      id: service.id,
      projectName: "Listed",
    });
  });

  it("lets owners and admins delete a Service with confirmation and records an AuditEvent", async () => {
    const owner = await signUp(uniqueName("svcdel") + "@example.test", uniqueName("svcdel"));
    const admin = await addMember(owner.cookie, owner.organizationId, "admin");
    const project = await createProject(owner.cookie, "Deletions");
    const service = await createService(owner.cookie, project.id, { name: "Doomed Service" });

    const wrong = await serviceRequest(
      admin.cookie,
      { serviceId: service.id },
      { method: "DELETE", body: { confirmation: "Wrong Name" } },
    );
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as FailureBody).error.code).toBe("confirmation_mismatch");

    const deleted = await serviceRequest(
      admin.cookie,
      { serviceId: service.id },
      { method: "DELETE", body: { confirmation: "Doomed Service" } },
    );
    expect(deleted.status).toBe(200);

    const after = await serviceRequest(owner.cookie, { serviceId: service.id });
    expect(after.status).toBe(404);

    const events = await queryRows<{ action: string; details: Record<string, unknown> }>(
      'SELECT "action", "details" FROM "audit_event" WHERE "organizationId" = $1 AND "action" LIKE $2 ORDER BY "id"',
      [owner.organizationId, "service.%"],
    );
    expect(events.map((event) => event.action)).toEqual(["service.created", "service.deleted"]);
    expect(events[1].details).toMatchObject({ serviceId: service.id, name: "Doomed Service" });
  });

  it("keeps members read-only", async () => {
    const owner = await signUp(
      uniqueName("readonlyowner") + "@example.test",
      uniqueName("readonlyowner"),
    );
    const member = await addMember(owner.cookie, owner.organizationId, "member");
    const project = await createProject(owner.cookie, "Shared");
    const service = await createService(owner.cookie, project.id);

    const list = await serviceRequest(member.cookie, { projectId: project.id });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { data: ServiceBody[] }).data).toHaveLength(1);

    const detail = await serviceRequest(member.cookie, { serviceId: service.id });
    expect(detail.status).toBe(200);

    const create = await serviceRequest(
      member.cookie,
      { projectId: project.id },
      { method: "POST", body: { name: "Member Service", repoUrl: REPO_URL } },
    );
    expect(create.status).toBe(403);

    const remove = await serviceRequest(
      member.cookie,
      { serviceId: service.id },
      { method: "DELETE", body: { confirmation: service.name } },
    );
    expect(remove.status).toBe(403);
  });

  it("isolates Services between Organizations", async () => {
    const first = await signUp(
      uniqueName("svctenanta") + "@example.test",
      uniqueName("svctenanta"),
    );
    const second = await signUp(
      uniqueName("svctenantb") + "@example.test",
      uniqueName("svctenantb"),
    );
    const project = await createProject(first.cookie, "Tenant A");
    const service = await createService(first.cookie, project.id);

    const read = await serviceRequest(second.cookie, { serviceId: service.id });
    expect(read.status).toBe(404);

    const listOtherProject = await serviceRequest(second.cookie, { projectId: project.id });
    expect(listOtherProject.status).toBe(404);

    const createInOtherProject = await serviceRequest(
      second.cookie,
      { projectId: project.id },
      { method: "POST", body: { name: "Stolen", repoUrl: REPO_URL } },
    );
    expect(createInOtherProject.status).toBe(404);

    const remove = await serviceRequest(
      second.cookie,
      { serviceId: service.id },
      { method: "DELETE", body: { confirmation: service.name } },
    );
    expect(remove.status).toBe(404);

    // The Organization-wide list only shows the caller's own Services.
    const organizationList = await serviceRequest(second.cookie, { organization: true });
    expect(((await organizationList.json()) as { data: ServiceBody[] }).data).toHaveLength(0);
  });

  it("removes Services when their Project is deleted", async () => {
    const owner = await signUp(
      uniqueName("svccascade") + "@example.test",
      uniqueName("svccascade"),
    );
    const project = await createProject(owner.cookie, "Cascade");
    const service = await createService(owner.cookie, project.id);

    const deleted = await projectRequest(owner.cookie, `/${project.id}`, {
      method: "DELETE",
      body: { confirmation: "Cascade" },
    });
    expect(deleted.status).toBe(200);

    const rows = await queryRows<{ count: string }>(
      'SELECT count(*) FROM "service" WHERE "id" = $1',
      [service.id],
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  it("requires authentication", async () => {
    const { GET } = await import("@/app/api/projects/[projectId]/services/route");
    const response = await GET(
      new Request(`${BASE_URL}/api/projects/any/services`, { headers: { origin: BASE_URL } }),
      { params: Promise.resolve({ projectId: "any" }) },
    );

    expect(response.status).toBe(401);
    expect(((await response.json()) as FailureBody).error.code).toBe("unauthenticated");
  });
});
