import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDatabase } from "../helpers/database";

const BASE_URL = "http://localhost:3000";
const PASSWORD = "password-12345";
const RUN_ID = Math.random().toString(36).slice(2, 8);
const AGENT_TOKEN = "test-agent-token";

function uniqueName(base: string): string {
  return `${base}${RUN_ID}`;
}

type Auth = (typeof import("@/lib/auth"))["auth"];

let auth: Auth;

type FakeServiceUsage = { cpuUsage: number; memoryUsageMb: number; volumeUsageMb: number };

/**
 * A fake Node Agent that only answers the endpoints this test needs: the usage
 * report the Control Plane records, and the Database provisioning call.
 */
type FakeAgent = {
  server: Server;
  baseUrl: string;
  requests: Array<{ method: string; path: string }>;
  services: Map<string, FakeServiceUsage>;
  databases: Map<string, number>;
  reset(): void;
};

async function startFakeAgent(): Promise<FakeAgent> {
  const agent: FakeAgent = {
    server: createServer(() => undefined),
    baseUrl: "",
    requests: [],
    services: new Map<string, FakeServiceUsage>(),
    databases: new Map<string, number>(),
    reset() {
      agent.requests = [];
      agent.services = new Map<string, FakeServiceUsage>();
      agent.databases = new Map<string, number>();
    },
  };

  agent.server = createServer((request, response) => {
    void handleAgentRequest(agent, request, response);
  });

  await new Promise<void>((resolve) => {
    agent.server.listen(0, "127.0.0.1", resolve);
  });

  const address = agent.server.address() as AddressInfo;
  agent.baseUrl = `http://127.0.0.1:${address.port}`;

  return agent;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleAgentRequest(
  agent: FakeAgent,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://agent.test");
  await readBody(request);

  if (request.headers.authorization !== `Bearer ${AGENT_TOKEN}`) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  agent.requests.push({ method: request.method ?? "GET", path: url.pathname });

  if (request.method === "GET" && url.pathname === "/v1/usage") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        capturedAt: new Date().toISOString(),
        services: [...agent.services.entries()].map(([serviceId, usage]) => ({
          serviceId,
          ...usage,
        })),
        databases: [...agent.databases.entries()].map(([databaseId, usageMb]) => ({
          databaseId,
          usageMb,
        })),
      }),
    );
    return;
  }

  const databaseMatch = /^\/v1\/databases\/([^/]+)$/.exec(url.pathname);
  if (databaseMatch && request.method === "PUT") {
    const databaseId = decodeURIComponent(databaseMatch[1]);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ databaseId, status: "running", healthy: true, usageMb: 0, overQuota: false }),
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not found" }));
}

let agent: FakeAgent;

beforeAll(async () => {
  process.env.ENV_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  await prepareTestDatabase();
  process.env.BETTER_AUTH_URL = BASE_URL;
  process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
  process.env.AGENT_TOKEN = AGENT_TOKEN;

  agent = await startFakeAgent();
  process.env.AGENT_BASE_URL = agent.baseUrl;
  process.env.AGENT_NAME = "test-node";

  ({ auth } = await import("@/lib/auth"));
});

afterAll(async () => {
  if (agent) {
    await new Promise<void>((resolve) => agent.server.close(() => resolve()));
  }
});

type SignUpResult = { cookie: string; userId: string; organizationId: string };

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
  const session = await auth.handler(
    new Request(`${BASE_URL}/api/auth/get-session`, {
      headers: { cookie, origin: BASE_URL },
    }),
  );
  const sessionBody = (await session.json()) as {
    session: { activeOrganizationId: string };
  };

  return {
    cookie,
    userId: body.user.id,
    organizationId: sessionBody.session.activeOrganizationId,
  };
}

async function addMember(
  ownerCookie: string,
  organizationId: string,
  role: "admin" | "member",
): Promise<SignUpResult> {
  const email = uniqueName(`usage${role}`) + Math.random().toString(36).slice(2, 6) + "@example.test";
  const inviteResponse = await auth.handler(
    new Request(`${BASE_URL}/api/auth/organization/invite-member`, {
      method: "POST",
      headers: { cookie: ownerCookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    }),
  );
  expect(inviteResponse.status).toBe(200);
  const invitation = (await inviteResponse.json()) as { id: string };

  const member = await signUp(email, email.split("@")[0].replace(/[^a-z0-9]/gi, ""));
  const accepted = await auth.handler(
    new Request(`${BASE_URL}/api/auth/organization/accept-invitation`, {
      method: "POST",
      headers: { cookie: member.cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ invitationId: invitation.id }),
    }),
  );
  expect(accepted.status).toBe(200);

  const session = await auth.handler(
    new Request(`${BASE_URL}/api/auth/get-session`, {
      headers: { cookie: member.cookie, origin: BASE_URL },
    }),
  );
  const sessionBody = (await session.json()) as {
    session: { activeOrganizationId: string };
  };
  expect(sessionBody.session.activeOrganizationId).toBe(organizationId);

  return member;
}

type ServiceBody = { id: string; name: string; projectId: string };
type FailureBody = {
  error: { code: string; message: string; details?: Record<string, unknown> };
};
type UsageBody = {
  capturedAt: string | null;
  limits: Record<string, number>;
  counts: {
    projects: { used: number; limit: number };
    services: { used: number; limit: number };
    databases: { used: number };
  };
  totals: { cpu: number; memoryMb: number; volumeMb: number; databaseMb: number };
  projects: Array<{
    id: string;
    name: string;
    serviceCount: number;
    serviceLimit: number;
    databaseCount: number;
    databaseLimit: number;
  }>;
  services: Array<{
    id: string;
    name: string;
    projectId: string;
    cpuUsage: number;
    cpuLimit: number;
    memoryUsageMb: number;
    memoryLimitMb: number;
    volumeUsageMb: number;
    volumeLimitMb: number;
  }>;
  databases: Array<{
    id: string;
    projectId: string;
    projectName: string;
    status: string;
    usageMb: number;
    storageLimitMb: number;
    overQuota: boolean;
  }>;
};

async function createProjectRequest(cookie: string, name: string): Promise<Response> {
  const { POST } = await import("@/app/api/projects/route");
  return POST(
    new Request(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  );
}

async function createProject(cookie: string, name: string): Promise<{ id: string }> {
  const response = await createProjectRequest(cookie, name);
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { id: string } }).data;
}

async function createServiceRequest(
  cookie: string,
  projectId: string,
  name: string,
): Promise<Response> {
  const { POST } = await import("@/app/api/projects/[projectId]/services/route");
  return POST(
    new Request(`${BASE_URL}/api/projects/${projectId}/services`, {
      method: "POST",
      headers: { cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({
        name,
        repoUrl: "https://github.com/example/web-app",
        branch: "main",
      }),
    }),
    { params: Promise.resolve({ projectId }) },
  );
}

async function createService(
  cookie: string,
  projectId: string,
  name: string,
): Promise<ServiceBody> {
  const response = await createServiceRequest(cookie, projectId, name);
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: ServiceBody }).data;
}

async function createDatabaseRequest(cookie: string, projectId: string): Promise<Response> {
  const { POST } = await import("@/app/api/projects/[projectId]/database/route");
  return POST(
    new Request(`${BASE_URL}/api/projects/${projectId}/database`, {
      method: "POST",
      headers: { cookie, origin: BASE_URL, "content-type": "application/json" },
    }),
    { params: Promise.resolve({ projectId }) },
  );
}

async function getUsage(cookie: string): Promise<Response> {
  const { GET } = await import("@/app/api/usage/route");
  return GET(
    new Request(`${BASE_URL}/api/usage`, {
      headers: { cookie, origin: BASE_URL },
    }),
  );
}

async function usageBody(cookie: string): Promise<UsageBody> {
  const response = await getUsage(cookie);
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: UsageBody }).data;
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

describe("Organization usage and Quota", () => {
  it("reports counts, limits, and the usage measured by the node", async () => {
    agent.reset();

    const owner = await signUp(uniqueName("useowner") + "@example.test", uniqueName("useowner"));
    const project = await createProject(owner.cookie, "Usage Project");
    const first = await createService(owner.cookie, project.id, "Usage App One");
    const second = await createService(owner.cookie, project.id, "Usage App Two");
    const databaseResponse = await createDatabaseRequest(owner.cookie, project.id);
    expect(databaseResponse.status).toBe(201);
    const database = ((await databaseResponse.json()) as { data: { id: string } }).data;

    agent.services.set(first.id, { cpuUsage: 0.25, memoryUsageMb: 128, volumeUsageMb: 40 });
    agent.services.set(second.id, { cpuUsage: 0.5, memoryUsageMb: 256, volumeUsageMb: 60 });
    agent.databases.set(database.id, 200);

    const usage = await usageBody(owner.cookie);

    expect(usage.capturedAt).not.toBeNull();
    expect(usage.counts).toEqual({
      projects: { used: 1, limit: 3 },
      services: { used: 2, limit: 5 },
      databases: { used: 1 },
    });
    expect(usage.limits).toEqual({
      projectsPerOrganization: 3,
      servicesPerProject: 2,
      servicesPerOrganization: 5,
      databasesPerProject: 1,
      cpuPerService: 0.5,
      memoryMbPerService: 512,
      volumeMbPerService: 1024,
      databaseStorageMb: 1024,
      buildConcurrencyPerNode: 1,
      logRetentionDays: 7,
    });

    // Totals are the sum of the newest measurement per resource.
    expect(usage.totals).toEqual({
      cpu: 0.75,
      memoryMb: 384,
      volumeMb: 100,
      databaseMb: 200,
    });

    expect(usage.projects).toEqual([
      {
        id: project.id,
        name: "Usage Project",
        serviceCount: 2,
        serviceLimit: 2,
        databaseCount: 1,
        databaseLimit: 1,
      },
    ]);

    const firstUsage = usage.services.find((service) => service.id === first.id);
    expect(firstUsage).toMatchObject({
      name: "Usage App One",
      projectId: project.id,
      cpuUsage: 0.25,
      cpuLimit: 0.5,
      memoryUsageMb: 128,
      memoryLimitMb: 512,
      volumeUsageMb: 40,
      volumeLimitMb: 1024,
    });

    expect(usage.databases).toEqual([
      {
        id: database.id,
        projectId: project.id,
        projectName: "Usage Project",
        status: "running",
        usageMb: 200,
        storageLimitMb: 1024,
        overQuota: false,
      },
    ]);
  });

  it("stores one snapshot batch per refresh and shows the newest measurement", async () => {
    agent.reset();

    const owner = await signUp(uniqueName("usesnap") + "@example.test", uniqueName("usesnap"));
    const project = await createProject(owner.cookie, "Snapshot Project");
    const service = await createService(owner.cookie, project.id, "Snapshot App");

    agent.services.set(service.id, { cpuUsage: 0.1, memoryUsageMb: 64, volumeUsageMb: 10 });

    const first = await usageBody(owner.cookie);
    expect(first.totals).toEqual({ cpu: 0.1, memoryMb: 64, volumeMb: 10, databaseMb: 0 });

    const rows = await queryRows<{
      serviceId: string | null;
      cpuUsage: string;
      memoryUsageMb: number;
      volumeUsageMb: number;
      capturedAt: Date;
    }>(
      `SELECT "serviceId", "cpuUsage", "memoryUsageMb", "volumeUsageMb", "capturedAt"
       FROM "usage_snapshot" WHERE "organizationId" = $1`,
      [owner.organizationId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      serviceId: service.id,
      cpuUsage: "0.1000",
      memoryUsageMb: 64,
      volumeUsageMb: 10,
    });
    expect(rows[0].capturedAt.toISOString()).toBe(first.capturedAt);

    // The next measurement replaces what the dashboard shows; history stays.
    agent.services.set(service.id, { cpuUsage: 0.4, memoryUsageMb: 200, volumeUsageMb: 30 });

    const second = await usageBody(owner.cookie);
    expect(second.totals).toEqual({ cpu: 0.4, memoryMb: 200, volumeMb: 30, databaseMb: 0 });
    expect(new Date(second.capturedAt as string).getTime()).toBeGreaterThan(
      new Date(first.capturedAt as string).getTime(),
    );

    const history = await queryRows<{ capturedAt: Date }>(
      `SELECT "capturedAt" FROM "usage_snapshot" WHERE "organizationId" = $1`,
      [owner.organizationId],
    );
    expect(history).toHaveLength(2);
  });

  it("lets a member read the Organization Quota", async () => {
    agent.reset();

    const owner = await signUp(uniqueName("usemember") + "@example.test", uniqueName("usemember"));
    const project = await createProject(owner.cookie, "Member Usage");
    await createService(owner.cookie, project.id, "Member Usage App");
    const member = await addMember(owner.cookie, owner.organizationId, "member");

    const response = await getUsage(member.cookie);
    expect(response.status).toBe(200);
    const usage = ((await response.json()) as { data: UsageBody }).data;
    expect(usage.counts.projects.used).toBe(1);
    expect(usage.counts.services.used).toBe(1);

    // Another Organization's usage is not visible.
    const other = await signUp(uniqueName("useother") + "@example.test", uniqueName("useother"));
    const otherUsage = await usageBody(other.cookie);
    expect(otherUsage.counts).toEqual({
      projects: { used: 0, limit: 3 },
      services: { used: 0, limit: 5 },
      databases: { used: 0 },
    });
    expect(otherUsage.capturedAt).toBeNull();
  });

  it("rejects a Project past the Organization Quota with the limit and current usage", async () => {
    const owner = await signUp(uniqueName("useproj") + "@example.test", uniqueName("useproj"));

    for (const name of ["First", "Second", "Third"]) {
      expect((await createProjectRequest(owner.cookie, name)).status).toBe(201);
    }

    const rejected = await createProjectRequest(owner.cookie, "Fourth");
    expect(rejected.status).toBe(409);
    const failure = (await rejected.json()) as FailureBody;
    expect(failure.error.code).toBe("quota_exceeded");
    expect(failure.error.message).toContain("Project Quota reached");
    expect(failure.error.details).toEqual({
      resource: "project",
      scope: "organization",
      limit: 3,
      usage: 3,
    });
  });

  it("rejects a Service past the Project Quota with the limit and current usage", async () => {
    const owner = await signUp(uniqueName("useprojsvc") + "@example.test", uniqueName("useprojsvc"));
    const project = await createProject(owner.cookie, "Service Quota");
    await createService(owner.cookie, project.id, "Quota App One");
    await createService(owner.cookie, project.id, "Quota App Two");

    const rejected = await createServiceRequest(owner.cookie, project.id, "Quota App Three");
    expect(rejected.status).toBe(409);
    const failure = (await rejected.json()) as FailureBody;
    expect(failure.error.code).toBe("quota_exceeded");
    expect(failure.error.message).toContain("Service Quota reached");
    expect(failure.error.details).toEqual({
      resource: "service",
      scope: "project",
      limit: 2,
      usage: 2,
    });
  });

  it("rejects a Service past the Organization Quota with the limit and current usage", async () => {
    const owner = await signUp(uniqueName("useorgsvc") + "@example.test", uniqueName("useorgsvc"));
    const first = await createProject(owner.cookie, "Org Quota One");
    const second = await createProject(owner.cookie, "Org Quota Two");
    const third = await createProject(owner.cookie, "Org Quota Three");

    await createService(owner.cookie, first.id, "Org App One");
    await createService(owner.cookie, first.id, "Org App Two");
    await createService(owner.cookie, second.id, "Org App Three");
    await createService(owner.cookie, second.id, "Org App Four");
    await createService(owner.cookie, third.id, "Org App Five");

    const rejected = await createServiceRequest(owner.cookie, third.id, "Org App Six");
    expect(rejected.status).toBe(409);
    const failure = (await rejected.json()) as FailureBody;
    expect(failure.error.code).toBe("quota_exceeded");
    expect(failure.error.message).toContain("Service Quota reached");
    expect(failure.error.details).toEqual({
      resource: "service",
      scope: "organization",
      limit: 5,
      usage: 5,
    });
  });

  it("rejects a Database past the Project Quota with the limit and current usage", async () => {
    const owner = await signUp(uniqueName("usedb") + "@example.test", uniqueName("usedb"));
    const project = await createProject(owner.cookie, "Database Quota");

    expect((await createDatabaseRequest(owner.cookie, project.id)).status).toBe(201);

    const rejected = await createDatabaseRequest(owner.cookie, project.id);
    expect(rejected.status).toBe(409);
    const failure = (await rejected.json()) as FailureBody;
    expect(failure.error.code).toBe("quota_exceeded");
    expect(failure.error.message).toContain("Database Quota reached");
    expect(failure.error.details).toEqual({
      resource: "database",
      scope: "project",
      limit: 1,
      usage: 1,
    });
  });
});
