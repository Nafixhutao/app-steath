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

/**
 * A fake Node Agent. It answers the Build and Deploy endpoints the worker calls,
 * and the Volume endpoints the Control Plane uses to measure and remove data.
 */
type FakeAgent = {
  server: Server;
  baseUrl: string;
  requests: Array<{ method: string; path: string; body?: unknown }>;
  volumes: Set<string>;
  usage: Map<string, number>;
  logLines: string[];
  reset(): void;
};

async function startFakeAgent(): Promise<FakeAgent> {
  const agent: FakeAgent = {
    server: createServer(() => undefined),
    baseUrl: "",
    requests: [],
    volumes: new Set<string>(),
    usage: new Map<string, number>(),
    logLines: ["Cloning into 'src'...", "Successfully built image"],
    reset() {
      agent.requests = [];
      agent.volumes = new Set<string>();
      agent.usage = new Map<string, number>();
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

function volumeNameFromPath(path: string): string {
  return decodeURIComponent(path.split("/").pop() as string);
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

  // Volume endpoints: the agent owns the Docker Volume and measures its usage.
  if (url.pathname.startsWith("/v1/volumes/")) {
    const name = volumeNameFromPath(url.pathname);
    const sizeMb = Number(url.searchParams.get("sizeMb") ?? 1024);

    if (request.method === "GET") {
      if (!agent.volumes.has(name)) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "volume_not_found" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          name,
          sizeMb,
          usageMb: agent.usage.get(name) ?? 0,
          exists: true,
        }),
      );
      return;
    }

    if (request.method === "PUT") {
      agent.volumes.add(name);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          name,
          sizeMb: Number(body?.sizeMb ?? sizeMb),
          usageMb: agent.usage.get(name) ?? 0,
          exists: true,
        }),
      );
      return;
    }

    if (request.method === "DELETE") {
      const removed = agent.volumes.delete(name);
      agent.usage.delete(name);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ name, removed }));
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
  const email = uniqueName(`vol${role}`) + Math.random().toString(36).slice(2, 6) + "@example.test";
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
type VolumeBody = {
  id: string;
  serviceId: string;
  mountPath: string;
  sizeMb: number;
  usageMb: number | null;
  exists: boolean;
  createdAt: string;
  updatedAt: string;
};
type VolumeListBody = { volume: VolumeBody | null; needsRedeploy: boolean };
type FailureBody = { error: { code: string; message: string } };

async function createProject(cookie: string, name: string): Promise<{ id: string }> {
  const { POST } = await import("@/app/api/projects/route");
  const response = await POST(
    new Request(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { id: string } }).data;
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

async function volumeRequest(
  cookie: string,
  serviceId: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const { GET, POST, DELETE } = await import("@/app/api/services/[serviceId]/volume/route");
  const request = new Request(`${BASE_URL}/api/services/${serviceId}/volume`, {
    method: init.method ?? "GET",
    headers: {
      cookie,
      origin: BASE_URL,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const context = { params: Promise.resolve({ serviceId }) };

  if (init.method === "POST") return POST(request, context);
  if (init.method === "DELETE") return DELETE(request, context);
  return GET(request, context);
}

async function serviceDeleteRequest(cookie: string, serviceId: string, name: string) {
  const { DELETE } = await import("@/app/api/services/[serviceId]/route");
  return DELETE(
    new Request(`${BASE_URL}/api/services/${serviceId}`, {
      method: "DELETE",
      headers: { cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ confirmation: name }),
    }),
    { params: Promise.resolve({ serviceId }) },
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

describe("Volumes", () => {
  it("creates one Volume per Service and reports the usage measured by the node", async () => {
    const owner = await signUp(uniqueName("volowner") + "@example.test", uniqueName("volowner"));
    const project = await createProject(owner.cookie, "Volume Project");
    const service = await createService(owner.cookie, project.id, "Volume App");

    const createdResponse = await volumeRequest(owner.cookie, service.id, {
      method: "POST",
      body: { mountPath: "/data" },
    });
    expect(createdResponse.status).toBe(201);
    const created = ((await createdResponse.json()) as { data: VolumeBody }).data;
    expect(created).toMatchObject({
      serviceId: service.id,
      mountPath: "/data",
      sizeMb: 1024,
      usageMb: 0,
      exists: false,
    });

    // The row is the Control Plane's record; the Docker Volume appears on deploy.
    const rows = await queryRows<{ dockerVolumeName: string; mountPath: string; sizeMb: number }>(
      'SELECT "dockerVolumeName", "mountPath", "sizeMb" FROM "volume" WHERE "serviceId" = $1',
      [service.id],
    );
    expect(rows).toEqual([
      { dockerVolumeName: `stealth-vol-${service.id}`, mountPath: "/data", sizeMb: 1024 },
    ]);

    // A Service may have at most one Volume.
    const duplicate = await volumeRequest(owner.cookie, service.id, {
      method: "POST",
      body: { mountPath: "/other" },
    });
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as FailureBody).error.code).toBe("volume_exists");

    // Once the agent owns the Volume, the usage comes from the node.
    agent.volumes.add(`stealth-vol-${service.id}`);
    agent.usage.set(`stealth-vol-${service.id}`, 128);

    const listResponse = await volumeRequest(owner.cookie, service.id);
    expect(listResponse.status).toBe(200);
    const list = ((await listResponse.json()) as { data: VolumeListBody }).data;
    expect(list.volume).toMatchObject({
      mountPath: "/data",
      sizeMb: 1024,
      usageMb: 128,
      exists: true,
    });
    expect(list.needsRedeploy).toBe(false);
  });

  it("rejects mount paths that are not absolute or could escape the mount", async () => {
    const owner = await signUp(uniqueName("volpath") + "@example.test", uniqueName("volpath"));
    const project = await createProject(owner.cookie, "Volume Path");
    const service = await createService(owner.cookie, project.id, "Path App");

    for (const mountPath of [
      "",
      "data",
      "/",
      "/data/../etc",
      "/data with space",
      "/data,readonly",
    ]) {
      const response = await volumeRequest(owner.cookie, service.id, {
        method: "POST",
        body: { mountPath },
      });
      expect(response.status, `mount path ${JSON.stringify(mountPath)}`).toBe(400);
      expect(((await response.json()) as FailureBody).error.code).toBe("invalid_mount_path");
    }

    for (const sizeMb of [0, 1025, 1.5]) {
      const response = await volumeRequest(owner.cookie, service.id, {
        method: "POST",
        body: { mountPath: "/data", sizeMb },
      });
      expect(response.status, `size ${sizeMb}`).toBe(400);
      expect(((await response.json()) as FailureBody).error.code).toBe("invalid_volume_size");
    }
  });

  it("lets members read the Volume but not create or delete it", async () => {
    const owner = await signUp(uniqueName("volrole") + "@example.test", uniqueName("volrole"));
    const project = await createProject(owner.cookie, "Volume Roles");
    const service = await createService(owner.cookie, project.id, "Role App");
    const member = await addMember(owner.cookie, owner.organizationId, "member");

    const created = await volumeRequest(owner.cookie, service.id, {
      method: "POST",
      body: { mountPath: "/data" },
    });
    expect(created.status).toBe(201);

    const read = await volumeRequest(member.cookie, service.id);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { data: VolumeListBody }).data.volume).toMatchObject({
      mountPath: "/data",
    });

    const create = await volumeRequest(member.cookie, service.id, {
      method: "POST",
      body: { mountPath: "/other" },
    });
    expect(create.status).toBe(403);

    const remove = await volumeRequest(member.cookie, service.id, { method: "DELETE" });
    expect(remove.status).toBe(403);
  });

  it("sends the Volume to the agent at the next Deployment and clears needsRedeploy", async () => {
    agent.reset();
    await sendHeartbeat();

    const owner = await signUp(uniqueName("volapply") + "@example.test", uniqueName("volapply"));
    const project = await createProject(owner.cookie, "Volume Apply");
    const service = await createService(owner.cookie, project.id, "Apply Volume App");
    const { getService } = await import("@/lib/platform/services");

    // The first Deployment runs without a Volume.
    const first = await triggerDeployment(owner.cookie, service.id);
    expect(await runJobFor(first.id)).toMatchObject({ status: "running" });
    const firstStart = agent.requests.find(
      (entry) => entry.method === "POST" && entry.path === "/v1/deployments",
    );
    expect(firstStart?.body).not.toHaveProperty("volume");

    // Adding a Volume after the Deployment is saved but not live yet.
    const created = await volumeRequest(owner.cookie, service.id, {
      method: "POST",
      body: { mountPath: "/data", sizeMb: 512 },
    });
    expect(created.status).toBe(201);
    expect((await getService(owner.organizationId, service.id)).needsRedeploy).toBe(true);

    agent.requests = [];
    const second = await triggerDeployment(owner.cookie, service.id);
    expect(await runJobFor(second.id)).toMatchObject({ status: "running" });

    const startRequest = agent.requests.find(
      (entry) => entry.method === "POST" && entry.path === "/v1/deployments",
    );
    expect(startRequest?.body).toMatchObject({
      deploymentId: second.id,
      volume: {
        name: `stealth-vol-${service.id}`,
        mountPath: "/data",
        sizeMb: 512,
      },
    });

    // The Deployment recorded the revision that included the Volume.
    expect((await getService(owner.organizationId, service.id)).needsRedeploy).toBe(false);
  });

  it("deletes the Volume through the agent and records AuditEvents", async () => {
    const owner = await signUp(uniqueName("volaudit") + "@example.test", uniqueName("volaudit"));
    const project = await createProject(owner.cookie, "Volume Audit");
    const service = await createService(owner.cookie, project.id, "Audited Volume App");

    const createdResponse = await volumeRequest(owner.cookie, service.id, {
      method: "POST",
      body: { mountPath: "/data" },
    });
    const created = ((await createdResponse.json()) as { data: VolumeBody }).data;
    const dockerVolumeName = `stealth-vol-${service.id}`;
    agent.volumes.add(dockerVolumeName);

    const removed = await volumeRequest(owner.cookie, service.id, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { data: { id: string } }).data.id).toBe(created.id);

    // The agent was asked to remove the data, and the row is gone.
    expect(
      agent.requests.some(
        (entry) => entry.method === "DELETE" && entry.path === `/v1/volumes/${dockerVolumeName}`,
      ),
    ).toBe(true);
    expect(agent.volumes.has(dockerVolumeName)).toBe(false);
    expect(
      await queryRows('SELECT "id" FROM "volume" WHERE "serviceId" = $1', [service.id]),
    ).toHaveLength(0);

    const events = await queryRows<{ action: string; details: Record<string, unknown> }>(
      'SELECT "action", "details" FROM "audit_event" WHERE "organizationId" = $1 AND "action" LIKE $2 ORDER BY "createdAt"',
      [owner.organizationId, "volume.%"],
    );
    expect(events.map((event) => event.action)).toEqual(["volume.created", "volume.deleted"]);
    for (const event of events) {
      expect(event.details).toHaveProperty("serviceId", service.id);
      expect(event.details).toHaveProperty("volumeId", created.id);
    }
    expect(events[0].details).toMatchObject({ mountPath: "/data", sizeMb: 1024 });
  });

  it("answers 404 for a Service in another Organization", async () => {
    const owner = await signUp(uniqueName("voltenant") + "@example.test", uniqueName("voltenant"));
    const other = await signUp(uniqueName("volother") + "@example.test", uniqueName("volother"));
    const project = await createProject(owner.cookie, "Volume Tenant");
    const service = await createService(owner.cookie, project.id, "Tenant Volume App");

    expect((await volumeRequest(other.cookie, service.id)).status).toBe(404);
    expect(
      (
        await volumeRequest(other.cookie, service.id, {
          method: "POST",
          body: { mountPath: "/data" },
        })
      ).status,
    ).toBe(404);
    expect((await volumeRequest(other.cookie, service.id, { method: "DELETE" })).status).toBe(404);
  });

  it("removes the Volume row when the Service is deleted", async () => {
    const owner = await signUp(
      uniqueName("volcascade") + "@example.test",
      uniqueName("volcascade"),
    );
    const project = await createProject(owner.cookie, "Volume Cascade");
    const service = await createService(owner.cookie, project.id, "Cascade Volume App");

    const created = await volumeRequest(owner.cookie, service.id, {
      method: "POST",
      body: { mountPath: "/data" },
    });
    expect(created.status).toBe(201);

    const removed = await serviceDeleteRequest(owner.cookie, service.id, "Cascade Volume App");
    expect(removed.status).toBe(200);

    expect(
      await queryRows('SELECT "id" FROM "volume" WHERE "serviceId" = $1', [service.id]),
    ).toHaveLength(0);
    // The Control Plane asks the agent to remove the Service runtime, which is
    // where the agent also removes the Docker Volume.
    expect(
      agent.requests.some(
        (entry) => entry.method === "DELETE" && entry.path === `/v1/services/${service.id}`,
      ),
    ).toBe(true);
  });
});
