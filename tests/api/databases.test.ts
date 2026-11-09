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

type FakeDatabase = {
  status: "running" | "stopped";
  healthy: boolean;
  usageMb: number;
  overQuota: boolean;
  password: string;
};

type FakeAgent = {
  server: Server;
  baseUrl: string;
  requests: Array<{ method: string; path: string; body?: unknown }>;
  databases: Map<string, FakeDatabase>;
  logLines: string[];
  reset(): void;
};

async function startFakeAgent(): Promise<FakeAgent> {
  const agent: FakeAgent = {
    server: createServer(() => undefined),
    baseUrl: "",
    requests: [],
    databases: new Map<string, FakeDatabase>(),
    logLines: ["Cloning into 'src'...", "Successfully built image"],
    reset() {
      agent.requests = [];
      agent.databases = new Map<string, FakeDatabase>();
      agent.logLines = ["Cloning into 'src'...", "Successfully built image"];
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

function databaseState(databaseId: string, database: FakeDatabase) {
  return {
    databaseId,
    status: database.status,
    containerId: `container-${databaseId}`,
    hostname: "db",
    storageLimitMb: 1024,
    usageMb: database.usageMb,
    healthy: database.healthy,
    overQuota: database.overQuota,
  };
}

async function handleAgentRequest(
  agent: FakeAgent,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://agent.test");
  const raw = await readBody(request);
  const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;

  if (request.headers.authorization !== `Bearer ${AGENT_TOKEN}`) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  agent.requests.push({ method: request.method ?? "GET", path: url.pathname, body });

  if (request.method === "POST" && url.pathname === "/v1/builds") {
    const buildId = String(body?.buildId);
    response.writeHead(202, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ buildId, status: "running", startedAt: new Date().toISOString() }),
    );
    return;
  }

  if (request.method === "GET" && /^\/v1\/builds\/[^/]+$/.test(url.pathname)) {
    const buildId = decodeURIComponent(url.pathname.split("/").pop() as string);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        buildId,
        status: "succeeded",
        imageRef: `stealth/service-test:${buildId}`,
        commitSha: "a".repeat(40),
        finishedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  if (request.method === "GET" && /^\/v1\/builds\/[^/]+\/logs$/.test(url.pathname)) {
    response.writeHead(200, { "content-type": "application/x-ndjson" });
    for (const [index, message] of agent.logLines.entries()) {
      response.write(
        `${JSON.stringify({ sequence: index + 1, message, timestamp: new Date().toISOString() })}\n`,
      );
    }
    response.end();
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/deployments") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        deploymentId: String(body?.deploymentId ?? ""),
        serviceId: String(body?.serviceId ?? ""),
        status: "running",
      }),
    );
    return;
  }

  // Database endpoints: the agent owns the container and reports its health.
  const rotateMatch = /^\/v1\/databases\/([^/]+)\/rotate$/.exec(url.pathname);
  if (rotateMatch && request.method === "POST") {
    const databaseId = decodeURIComponent(rotateMatch[1]);
    const database = agent.databases.get(databaseId);
    if (!database) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "database_not_found" }));
      return;
    }
    database.password = String(body?.password ?? "");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(databaseState(databaseId, database)));
    return;
  }

  const databaseMatch = /^\/v1\/databases\/([^/]+)$/.exec(url.pathname);
  if (databaseMatch) {
    const databaseId = decodeURIComponent(databaseMatch[1]);

    if (request.method === "PUT") {
      agent.databases.set(databaseId, {
        status: "running",
        healthy: true,
        usageMb: 0,
        overQuota: false,
        password: String(body?.password ?? ""),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(databaseState(databaseId, agent.databases.get(databaseId)!)));
      return;
    }

    const database = agent.databases.get(databaseId);
    if (request.method === "GET") {
      if (!database) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "database_not_found" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(databaseState(databaseId, database)));
      return;
    }

    if (request.method === "DELETE") {
      const removed = agent.databases.delete(databaseId);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ databaseId, removed }));
      return;
    }
  }

  if (request.method === "DELETE" && /^\/v1\/services\/[^/]+$/.test(url.pathname)) {
    const serviceId = decodeURIComponent(url.pathname.split("/").pop() as string);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ serviceId, status: "absent" }));
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
  // A fixed 32-byte key so the encryption under test is deterministic.
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
  const email = uniqueName(`db${role}`) + Math.random().toString(36).slice(2, 6) + "@example.test";
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

type ServiceBody = { id: string; name: string; status: string; projectId: string };
type DatabaseBody = {
  id: string;
  projectId: string;
  engine: string;
  version: string;
  databaseName: string;
  username: string;
  storageLimitMb: number;
  status: string;
  healthy: boolean;
  usageMb: number | null;
  overQuota: boolean;
  connectionString: string | null;
  createdAt: string;
  updatedAt: string;
};
type DatabaseListBody = { database: DatabaseBody | null; needsRedeploy: boolean };
type FailureBody = { error: { code: string; message: string } };

async function createProject(cookie: string, name: string): Promise<{ id: string; name: string }> {
  const { POST } = await import("@/app/api/projects/route");
  const response = await POST(
    new Request(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { id: string; name: string } }).data;
}

async function createService(
  cookie: string,
  projectId: string,
  name: string,
): Promise<ServiceBody> {
  const { POST } = await import("@/app/api/projects/[projectId]/services/route");
  const response = await POST(
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
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: ServiceBody }).data;
}

async function databaseRequest(
  cookie: string,
  projectId: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const { GET, POST, DELETE } = await import("@/app/api/projects/[projectId]/database/route");
  const request = new Request(`${BASE_URL}/api/projects/${projectId}/database`, {
    method: init.method ?? "GET",
    headers: {
      cookie,
      origin: BASE_URL,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const context = { params: Promise.resolve({ projectId }) };

  if (init.method === "POST") return POST(request, context);
  if (init.method === "DELETE") return DELETE(request, context);
  return GET(request, context);
}

async function rotateRequest(cookie: string, projectId: string): Promise<Response> {
  const { POST } = await import("@/app/api/projects/[projectId]/database/rotate/route");
  return POST(
    new Request(`${BASE_URL}/api/projects/${projectId}/database/rotate`, {
      method: "POST",
      headers: { cookie, origin: BASE_URL },
    }),
    { params: Promise.resolve({ projectId }) },
  );
}

async function listDatabases(cookie: string): Promise<Response> {
  const { GET } = await import("@/app/api/databases/route");
  return GET(
    new Request(`${BASE_URL}/api/databases`, {
      headers: { cookie, origin: BASE_URL },
    }),
  );
}

async function sendHeartbeat(token = AGENT_TOKEN): Promise<Response> {
  const { POST } = await import("@/app/api/nodes/heartbeat/route");
  return POST(
    new Request(`${BASE_URL}/api/nodes/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        capacity: { dockerVersion: "29.9.2", buildkitAvailable: true, cpuCount: 4, memoryMb: 8192 },
      }),
    }),
  );
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

async function runJobFor(deploymentId: string): Promise<{ status: string } | null> {
  const { claimBuildJob, completeJob, runBuildJob, runDeployment } =
    await import("@/lib/platform/deployments");

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const job = await claimBuildJob();
    if (!job) return null;

    if (job.payload.deploymentId === deploymentId) {
      const result = await runBuildJob(job);
      if (result.status !== "deploying") {
        await completeJob(job.id, "failed");
        return result;
      }
      const deployed = await runDeployment(deploymentId);
      await completeJob(job.id, deployed.status === "failed" ? "failed" : "succeeded");
      return deployed;
    }

    await completeJob(job.id);
  }

  return null;
}

async function triggerDeployment(cookie: string, serviceId: string): Promise<{ id: string }> {
  const route = await import("@/app/api/services/[serviceId]/deployments/route");
  const response = await route.POST(
    new Request(`${BASE_URL}/api/services/${serviceId}/deployments`, {
      method: "POST",
      headers: { cookie, origin: BASE_URL },
    }),
    { params: Promise.resolve({ serviceId }) },
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { id: string } }).data;
}

function deploymentStart(agentState: FakeAgent) {
  return agentState.requests.find(
    (entry) => entry.method === "POST" && entry.path === "/v1/deployments",
  );
}

describe("Databases", () => {
  it("creates one private Database per Project and rejects a second with a Quota error", async () => {
    const owner = await signUp(uniqueName("dbowner") + "@example.test", uniqueName("dbowner"));
    const project = await createProject(owner.cookie, "Database Project");

    const response = await databaseRequest(owner.cookie, project.id, { method: "POST" });
    expect(response.status).toBe(201);
    const database = ((await response.json()) as { data: DatabaseBody }).data;

    expect(database).toMatchObject({
      projectId: project.id,
      engine: "postgres",
      version: "16",
      databaseName: "app",
      username: "app",
      storageLimitMb: 1024,
      status: "running",
      healthy: true,
      usageMb: 0,
      overQuota: false,
    });
    expect(database.connectionString).toMatch(/^postgres:\/\/app:[0-9a-f]{64}@db:5432\/app$/);

    // The password is random and sealed at rest.
    const rows = await queryRows<{ encryptedPassword: string }>(
      'SELECT "encryptedPassword" FROM "database" WHERE "id" = $1',
      [database.id],
    );
    expect(rows[0].encryptedPassword).toMatch(/^v1\./);
    const plaintext = new URL(database.connectionString as string).password;
    expect(rows[0].encryptedPassword).not.toContain(plaintext);
    expect(agent.databases.get(database.id)?.password).toBe(plaintext);

    // A second Database in the same Project is a Quota error.
    const duplicate = await databaseRequest(owner.cookie, project.id, { method: "POST" });
    expect(duplicate.status).toBe(409);
    const failure = (await duplicate.json()) as FailureBody;
    expect(failure.error.code).toBe("quota_exceeded");
    expect(failure.error.message).toContain("Database Quota reached");

    // The Project summary counts the Database.
    const { GET: getProjectRoute } = await import("@/app/api/projects/[projectId]/route");
    const projectResponse = await getProjectRoute(
      new Request(`${BASE_URL}/api/projects/${project.id}`, {
        headers: { cookie: owner.cookie, origin: BASE_URL },
      }),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    expect(projectResponse.status).toBe(200);
    expect(
      ((await projectResponse.json()) as { data: { databaseCount: number } }).data,
    ).toMatchObject({ databaseCount: 1 });

    // The organization-wide list carries the Project name.
    const listResponse = await listDatabases(owner.cookie);
    expect(listResponse.status).toBe(200);
    const listed = (
      (await listResponse.json()) as {
        data: Array<{ id: string; projectName: string; connectionString: string | null }>;
      }
    ).data;
    expect(listed).toContainEqual(
      expect.objectContaining({
        id: database.id,
        projectName: "Database Project",
        connectionString: database.connectionString,
      }),
    );
  });

  it("lets members see the Database but not the connection string or any mutation", async () => {
    const owner = await signUp(uniqueName("dbrole") + "@example.test", uniqueName("dbrole"));
    const project = await createProject(owner.cookie, "Database Roles");
    const member = await addMember(owner.cookie, owner.organizationId, "member");

    const created = await databaseRequest(owner.cookie, project.id, { method: "POST" });
    expect(created.status).toBe(201);

    const read = await databaseRequest(member.cookie, project.id);
    expect(read.status).toBe(200);
    const body = ((await read.json()) as { data: DatabaseListBody }).data;
    expect(body.database).toMatchObject({ projectId: project.id, status: "running" });
    expect(body.database?.connectionString).toBeNull();

    const list = await listDatabases(member.cookie);
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { data: Array<{ connectionString: string | null }> };
    expect(listed.data.every((row) => row.connectionString === null)).toBe(true);

    expect((await databaseRequest(member.cookie, project.id, { method: "POST" })).status).toBe(403);
    expect((await rotateRequest(member.cookie, project.id)).status).toBe(403);
    expect(
      (
        await databaseRequest(member.cookie, project.id, {
          method: "DELETE",
          body: { confirmation: "Database Roles" },
        })
      ).status,
    ).toBe(403);
  });

  it("rotates the password, returns a new connection string, and audits without the secret", async () => {
    const owner = await signUp(uniqueName("dbrotate") + "@example.test", uniqueName("dbrotate"));
    const project = await createProject(owner.cookie, "Database Rotate");

    const createdResponse = await databaseRequest(owner.cookie, project.id, { method: "POST" });
    const created = ((await createdResponse.json()) as { data: DatabaseBody }).data;

    const rotatedResponse = await rotateRequest(owner.cookie, project.id);
    expect(rotatedResponse.status).toBe(200);
    const rotated = ((await rotatedResponse.json()) as { data: DatabaseBody }).data;

    expect(rotated.connectionString).not.toBe(created.connectionString);
    const newPassword = new URL(rotated.connectionString as string).password;
    expect(agent.databases.get(created.id)?.password).toBe(newPassword);

    const rows = await queryRows<{ encryptedPassword: string }>(
      'SELECT "encryptedPassword" FROM "database" WHERE "id" = $1',
      [created.id],
    );
    expect(rows[0].encryptedPassword).not.toContain(newPassword);

    const events = await queryRows<{ action: string; details: Record<string, unknown> }>(
      'SELECT "action", "details" FROM "audit_event" WHERE "organizationId" = $1 AND "action" LIKE $2 ORDER BY "createdAt"',
      [owner.organizationId, "database.%"],
    );
    expect(events.map((event) => event.action)).toEqual([
      "database.created",
      "database.credentials_rotated",
    ]);
    expect(events[1].details).toEqual({ projectId: project.id, databaseId: created.id });
    expect(JSON.stringify(events[1].details)).not.toContain(newPassword);
  });

  it("requires the Project name to delete and records the AuditEvent", async () => {
    const owner = await signUp(uniqueName("dbaudit") + "@example.test", uniqueName("dbaudit"));
    const project = await createProject(owner.cookie, "Database Audit");

    const createdResponse = await databaseRequest(owner.cookie, project.id, { method: "POST" });
    const created = ((await createdResponse.json()) as { data: DatabaseBody }).data;

    const wrong = await databaseRequest(owner.cookie, project.id, {
      method: "DELETE",
      body: { confirmation: "Not The Name" },
    });
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as FailureBody).error.code).toBe("confirmation_mismatch");

    const removed = await databaseRequest(owner.cookie, project.id, {
      method: "DELETE",
      body: { confirmation: "Database Audit" },
    });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { data: { id: string } }).data.id).toBe(created.id);

    expect(
      agent.requests.some(
        (entry) => entry.method === "DELETE" && entry.path === `/v1/databases/${created.id}`,
      ),
    ).toBe(true);
    expect(agent.databases.has(created.id)).toBe(false);
    expect(
      await queryRows('SELECT "id" FROM "database" WHERE "projectId" = $1', [project.id]),
    ).toHaveLength(0);

    const events = await queryRows<{ action: string; details: Record<string, unknown> }>(
      'SELECT "action", "details" FROM "audit_event" WHERE "organizationId" = $1 AND "action" LIKE $2 ORDER BY "createdAt"',
      [owner.organizationId, "database.%"],
    );
    expect(events.map((event) => event.action)).toEqual(["database.created", "database.deleted"]);
    expect(events[1].details).toMatchObject({
      projectId: project.id,
      databaseId: created.id,
      engine: "postgres",
      version: "16",
    });
  });

  it("injects DATABASE_URL into every Service, reserves the key, and drops it after delete", async () => {
    agent.reset();
    await sendHeartbeat();

    const owner = await signUp(uniqueName("dbinject") + "@example.test", uniqueName("dbinject"));
    const project = await createProject(owner.cookie, "Database Inject");
    const service = await createService(owner.cookie, project.id, "Injected App");
    const { getService } = await import("@/lib/platform/services");

    // First Deployment runs without a Database.
    const first = await triggerDeployment(owner.cookie, service.id);
    expect(await runJobFor(first.id)).toMatchObject({ status: "running" });
    expect(deploymentStart(agent)?.body).not.toHaveProperty("environmentVariables");

    // Creating the Database marks the running Service as needing a redeploy.
    const createdResponse = await databaseRequest(owner.cookie, project.id, { method: "POST" });
    const created = ((await createdResponse.json()) as { data: DatabaseBody }).data;
    expect((await getService(owner.organizationId, service.id)).needsRedeploy).toBe(true);

    agent.requests = [];
    const second = await triggerDeployment(owner.cookie, service.id);
    expect(await runJobFor(second.id)).toMatchObject({ status: "running" });

    const startBody = deploymentStart(agent)?.body as {
      environmentVariables?: Array<{ name: string; value: string }>;
    };
    const injected = startBody.environmentVariables?.find(
      (variable) => variable.name === "DATABASE_URL",
    );
    expect(injected?.value).toBe(created.connectionString);
    expect((await getService(owner.organizationId, service.id)).needsRedeploy).toBe(false);

    // A user cannot shadow the platform value.
    const { createEnvironmentVariable } = await import("@/lib/platform/environment-variables");
    await expect(
      createEnvironmentVariable({
        organizationId: owner.organizationId,
        serviceId: service.id,
        key: "DATABASE_URL",
        value: "postgres://evil@elsewhere/app",
      }),
    ).rejects.toMatchObject({ code: "reserved_environment_key" });

    // Deleting the Database means the next Deployment no longer receives it.
    const removed = await databaseRequest(owner.cookie, project.id, {
      method: "DELETE",
      body: { confirmation: "Database Inject" },
    });
    expect(removed.status).toBe(200);
    expect((await getService(owner.organizationId, service.id)).needsRedeploy).toBe(true);

    agent.requests = [];
    const third = await triggerDeployment(owner.cookie, service.id);
    expect(await runJobFor(third.id)).toMatchObject({ status: "running" });
    const thirdBody = deploymentStart(agent)?.body as {
      environmentVariables?: Array<{ name: string; value: string }>;
    };
    expect(
      thirdBody.environmentVariables?.some((variable) => variable.name === "DATABASE_URL"),
    ).toBeFalsy();
  });

  it("reports the health and usage the node measures", async () => {
    const owner = await signUp(uniqueName("dbhealth") + "@example.test", uniqueName("dbhealth"));
    const project = await createProject(owner.cookie, "Database Health");

    const createdResponse = await databaseRequest(owner.cookie, project.id, { method: "POST" });
    const created = ((await createdResponse.json()) as { data: DatabaseBody }).data;

    const state = agent.databases.get(created.id)!;
    state.usageMb = 900;
    state.healthy = false;
    state.status = "stopped";

    const response = await databaseRequest(owner.cookie, project.id);
    expect(response.status).toBe(200);
    const body = ((await response.json()) as { data: DatabaseListBody }).data;
    expect(body.database).toMatchObject({
      status: "stopped",
      healthy: false,
      usageMb: 900,
      overQuota: false,
    });
  });

  it("validates the storage limit and answers 404 for another Organization", async () => {
    const owner = await signUp(uniqueName("dbtenant") + "@example.test", uniqueName("dbtenant"));
    const other = await signUp(uniqueName("dbother") + "@example.test", uniqueName("dbother"));
    const project = await createProject(owner.cookie, "Database Tenant");

    for (const storageLimitMb of [0, 1025, 1.5]) {
      const response = await databaseRequest(owner.cookie, project.id, {
        method: "POST",
        body: { storageLimitMb },
      });
      expect(response.status, `storage ${storageLimitMb}`).toBe(400);
      expect(((await response.json()) as FailureBody).error.code).toBe("invalid_database_storage");
    }

    expect((await databaseRequest(other.cookie, project.id)).status).toBe(404);
    expect((await databaseRequest(other.cookie, project.id, { method: "POST" })).status).toBe(404);
    expect((await rotateRequest(other.cookie, project.id)).status).toBe(404);
    expect(
      (
        await databaseRequest(other.cookie, project.id, {
          method: "DELETE",
          body: { confirmation: "Database Tenant" },
        })
      ).status,
    ).toBe(404);
  });
});
