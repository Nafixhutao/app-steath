import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDatabase } from "../helpers/database";

const BASE_URL = "http://localhost:3000";
const PASSWORD = "password-12345";
const RUN_ID = Math.random().toString(36).slice(2, 8);
const AGENT_TOKEN = "test-agent-token";
const SECRET_VALUE = "s3cr3t-value-do-not-leak";

function uniqueName(base: string): string {
  return `${base}${RUN_ID}`;
}

type Auth = (typeof import("@/lib/auth"))["auth"];

let auth: Auth;

/**
 * A fake Node Agent. Like the Deployment tests' fake it records requests instead
 * of building, but it also answers `POST /v1/deployments`, because what this
 * file proves is that the Deployment request carries the decrypted environment.
 */
type FakeAgent = {
  server: Server;
  baseUrl: string;
  requests: Array<{ method: string; path: string; body?: unknown }>;
  logLines: string[];
  reset(): void;
};

async function startFakeAgent(): Promise<FakeAgent> {
  const agent: FakeAgent = {
    server: createServer(() => undefined),
    baseUrl: "",
    requests: [],
    logLines: ["Cloning into 'src'...", "Successfully built image"],
    reset() {
      agent.requests = [];
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

  // POST /v1/builds
  if (request.method === "POST" && url.pathname === "/v1/builds") {
    const buildId = String(body?.buildId);

    response.writeHead(202, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        buildId,
        status: "running",
        startedAt: new Date().toISOString(),
      }),
    );
    return;
  }

  // GET /v1/builds/{id}
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

  // GET /v1/builds/{id}/logs
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

  // POST /v1/deployments
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
  // A fixed 32-byte base64 key so the encryption under test is deterministic in
  // strength; the values themselves are still sealed with a fresh random IV.
  process.env.ENV_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

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
  const email = uniqueName(`env${role}`) + Math.random().toString(36).slice(2, 6) + "@example.test";
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
type VariableBody = {
  id: string;
  serviceId: string;
  key: string;
  maskedValue: string;
  createdAt: string;
  updatedAt: string;
};

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

async function variablesRequest(
  cookie: string,
  serviceId: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const { GET, POST } = await import("@/app/api/services/[serviceId]/environment-variables/route");
  const request = new Request(`${BASE_URL}/api/services/${serviceId}/environment-variables`, {
    method: init.method ?? "GET",
    headers: {
      cookie,
      origin: BASE_URL,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  return init.method === "POST"
    ? POST(request, { params: Promise.resolve({ serviceId }) })
    : GET(request, { params: Promise.resolve({ serviceId }) });
}

async function variableRequest(
  cookie: string,
  serviceId: string,
  variableId: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const { PATCH, DELETE } =
    await import("@/app/api/services/[serviceId]/environment-variables/[variableId]/route");
  const request = new Request(
    `${BASE_URL}/api/services/${serviceId}/environment-variables/${variableId}`,
    {
      method: init.method ?? "PATCH",
      headers: {
        cookie,
        origin: BASE_URL,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    },
  );

  return init.method === "DELETE"
    ? DELETE(request, { params: Promise.resolve({ serviceId, variableId }) })
    : PATCH(request, { params: Promise.resolve({ serviceId, variableId }) });
}

async function revealRequest(
  cookie: string,
  serviceId: string,
  variableId: string,
): Promise<Response> {
  const { POST } =
    await import("@/app/api/services/[serviceId]/environment-variables/[variableId]/reveal/route");
  return POST(
    new Request(
      `${BASE_URL}/api/services/${serviceId}/environment-variables/${variableId}/reveal`,
      { method: "POST", headers: { cookie, origin: BASE_URL } },
    ),
    { params: Promise.resolve({ serviceId, variableId }) },
  );
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

/**
 * Runs the Build Job belonging to one Deployment exactly the way the worker
 * does, including running the container afterwards. Any Job left behind by an
 * earlier test is completed first so the assertion always observes its own
 * Deployment.
 */
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

describe("Environment Variables", () => {
  it("masks values by default, reveals only on explicit request, and stores only ciphertext", async () => {
    const owner = await signUp(uniqueName("envowner") + "@example.test", uniqueName("envowner"));
    const project = await createProject(owner.cookie, "Env Masking");
    const service = await createService(owner.cookie, project.id, "Masked App");

    const createdResponse = await variablesRequest(owner.cookie, service.id, {
      method: "POST",
      body: { key: "API_TOKEN", value: SECRET_VALUE },
    });
    expect(createdResponse.status).toBe(201);
    const created = ((await createdResponse.json()) as { data: VariableBody }).data;
    expect(created.key).toBe("API_TOKEN");
    // The response carries the masked placeholder, never the value.
    expect(created.maskedValue).toBe("********");
    expect(JSON.stringify(created)).not.toContain(SECRET_VALUE);

    // The list is masked too.
    const listResponse = await variablesRequest(owner.cookie, service.id);
    expect(listResponse.status).toBe(200);
    const list = ((await listResponse.json()) as { data: { variables: VariableBody[] } }).data;
    expect(list.variables).toHaveLength(1);
    expect(list.variables[0].maskedValue).toBe("********");
    expect(JSON.stringify(list)).not.toContain(SECRET_VALUE);

    // The database holds a sealed value, not the plaintext.
    const rows = await queryRows<{ valueCiphertext: string }>(
      'SELECT "valueCiphertext" FROM "environment_variable" WHERE "id" = $1',
      [created.id],
    );
    expect(rows).toHaveLength(1);
    const ciphertext = rows[0].valueCiphertext;
    expect(ciphertext).not.toContain(SECRET_VALUE);
    expect(ciphertext).toMatch(/^v1\./);

    // The same value seals to a different ciphertext each time (random IV).
    const second = await variablesRequest(owner.cookie, service.id, {
      method: "POST",
      body: { key: "OTHER_TOKEN", value: SECRET_VALUE },
    });
    expect(second.status).toBe(201);
    const secondRows = await queryRows<{ valueCiphertext: string }>(
      'SELECT "valueCiphertext" FROM "environment_variable" WHERE "key" = $1 AND "serviceId" = $2',
      ["OTHER_TOKEN", service.id],
    );
    expect(secondRows[0].valueCiphertext).not.toBe(ciphertext);

    // Reveal returns the original plaintext and is never cached.
    const revealResponse = await revealRequest(owner.cookie, service.id, created.id);
    expect(revealResponse.status).toBe(200);
    expect(revealResponse.headers.get("cache-control")).toBe("no-store");
    const revealed = (await revealResponse.json()) as {
      data: { id: string; key: string; value: string };
    };
    expect(revealed.data).toMatchObject({ id: created.id, key: "API_TOKEN", value: SECRET_VALUE });
  });

  it("rejects reserved keys, invalid keys, and duplicate keys", async () => {
    const owner = await signUp(uniqueName("envkeys") + "@example.test", uniqueName("envkeys"));
    const project = await createProject(owner.cookie, "Env Keys");
    const service = await createService(owner.cookie, project.id, "Key Rules App");

    const reserved: Array<[string, string]> = [
      ["DATABASE_URL", "reserved_environment_key"],
      ["database_url", "reserved_environment_key"],
      ["STEALTH_FOO", "reserved_environment_key"],
      ["stealth_bar", "reserved_environment_key"],
      ["1BAD", "invalid_environment_key"],
      ["has space", "invalid_environment_key"],
    ];
    for (const [key, code] of reserved) {
      const response = await variablesRequest(owner.cookie, service.id, {
        method: "POST",
        body: { key, value: "x" },
      });
      expect(response.status, key).toBe(400);
      expect(((await response.json()) as FailureBody).error.code, key).toBe(code);
    }

    const first = await variablesRequest(owner.cookie, service.id, {
      method: "POST",
      body: { key: "SHARED_KEY", value: "one" },
    });
    expect(first.status).toBe(201);

    const duplicate = await variablesRequest(owner.cookie, service.id, {
      method: "POST",
      body: { key: "SHARED_KEY", value: "two" },
    });
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as FailureBody).error.code).toBe(
      "environment_variable_exists",
    );
  });

  it("updates and deletes variables, bumping the revision each time", async () => {
    const owner = await signUp(uniqueName("envupddel") + "@example.test", uniqueName("envupddel"));
    const project = await createProject(owner.cookie, "Env Update");
    const service = await createService(owner.cookie, project.id, "Update App");

    const createdResponse = await variablesRequest(owner.cookie, service.id, {
      method: "POST",
      body: { key: "FEATURE_FLAG", value: "off" },
    });
    const created = ((await createdResponse.json()) as { data: VariableBody }).data;

    // Rename the key without touching the value.
    const renamed = await variableRequest(owner.cookie, service.id, created.id, {
      method: "PATCH",
      body: { key: "FEATURE_FLAG_V2" },
    });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { data: VariableBody }).data.key).toBe("FEATURE_FLAG_V2");

    // The renamed variable still reveals the original value.
    const revealed = await revealRequest(owner.cookie, service.id, created.id);
    expect(((await revealed.json()) as { data: { value: string } }).data.value).toBe("off");

    // Change the value.
    const changed = await variableRequest(owner.cookie, service.id, created.id, {
      method: "PATCH",
      body: { value: "on" },
    });
    expect(changed.status).toBe(200);

    const revealedAgain = await revealRequest(owner.cookie, service.id, created.id);
    expect(((await revealedAgain.json()) as { data: { value: string } }).data.value).toBe("on");

    // The revision was bumped by every mutation so far: create + 2 updates.
    const before = await queryRows<{ envRevision: string }>(
      'SELECT "envRevision" FROM "service" WHERE "id" = $1',
      [service.id],
    );
    expect(Number(before[0].envRevision)).toBe(3);

    // Delete the variable.
    const removed = await variableRequest(owner.cookie, service.id, created.id, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);

    const gone = await revealRequest(owner.cookie, service.id, created.id);
    expect(gone.status).toBe(404);
    expect(((await gone.json()) as FailureBody).error.code).toBe("environment_variable_not_found");
  });

  it("lets members read but not create, update, or reveal", async () => {
    const owner = await signUp(uniqueName("envroles") + "@example.test", uniqueName("envroles"));
    const member = await addMember(owner.cookie, owner.organizationId, "member");
    const project = await createProject(owner.cookie, "Env Roles");
    const service = await createService(owner.cookie, project.id, "Role App");

    const read = await variablesRequest(member.cookie, service.id);
    expect(read.status).toBe(200);

    const create = await variablesRequest(member.cookie, service.id, {
      method: "POST",
      body: { key: "MEMBER_KEY", value: "x" },
    });
    expect(create.status).toBe(403);

    const ownerCreated = await variablesRequest(owner.cookie, service.id, {
      method: "POST",
      body: { key: "OWNER_KEY", value: "x" },
    });
    expect(ownerCreated.status).toBe(201);
    const variable = ((await ownerCreated.json()) as { data: VariableBody }).data;

    const patch = await variableRequest(member.cookie, service.id, variable.id, {
      method: "PATCH",
      body: { value: "y" },
    });
    expect(patch.status).toBe(403);

    const reveal = await revealRequest(member.cookie, service.id, variable.id);
    expect(reveal.status).toBe(403);

    const remove = await variableRequest(member.cookie, service.id, variable.id, {
      method: "DELETE",
    });
    expect(remove.status).toBe(403);
  });

  it("answers 404 for a Service in another Organization", async () => {
    const first = await signUp(
      uniqueName("envtenanta") + "@example.test",
      uniqueName("envtenanta"),
    );
    const second = await signUp(
      uniqueName("envtenantb") + "@example.test",
      uniqueName("envtenantb"),
    );
    const project = await createProject(first.cookie, "Tenant A");
    const service = await createService(first.cookie, project.id, "Tenant App");

    const list = await variablesRequest(second.cookie, service.id);
    expect(list.status).toBe(404);

    const create = await variablesRequest(second.cookie, service.id, {
      method: "POST",
      body: { key: "KEY", value: "x" },
    });
    expect(create.status).toBe(404);
  });

  it("applies new values at the next Deployment and clears needsRedeploy", async () => {
    agent.reset();
    await sendHeartbeat();

    const owner = await signUp(uniqueName("envapply") + "@example.test", uniqueName("envapply"));
    const project = await createProject(owner.cookie, "Env Apply");
    const service = await createService(owner.cookie, project.id, "Apply App");

    const createdResponse = await variablesRequest(owner.cookie, service.id, {
      method: "POST",
      body: { key: "API_TOKEN", value: SECRET_VALUE },
    });
    const variable = ((await createdResponse.json()) as { data: VariableBody }).data;

    // A Service without a running Deployment does not claim to need one.
    const { getService } = await import("@/lib/platform/services");
    expect((await getService(owner.organizationId, service.id)).needsRedeploy).toBe(false);

    const deployResponse = await import("@/app/api/services/[serviceId]/deployments/route");
    const deployed = await deployResponse.POST(
      new Request(`${BASE_URL}/api/services/${service.id}/deployments`, {
        method: "POST",
        headers: { cookie: owner.cookie, origin: BASE_URL },
      }),
      { params: Promise.resolve({ serviceId: service.id }) },
    );
    expect(deployed.status).toBe(201);
    const deployment = ((await deployed.json()) as { data: { id: string } }).data;

    const result = await runJobFor(deployment.id);
    expect(result).toMatchObject({ status: "running" });

    // The agent received the decrypted environment, keyed by name.
    const startRequest = agent.requests.find(
      (entry) => entry.method === "POST" && entry.path === "/v1/deployments",
    );
    expect(startRequest?.body).toMatchObject({
      deploymentId: deployment.id,
      environmentVariables: [{ name: "API_TOKEN", value: SECRET_VALUE }],
    });
    expect(JSON.stringify(startRequest?.body)).not.toContain("valueCiphertext");

    // The Deployment recorded the revision it was started with, so the Service
    // no longer claims to need a redeploy.
    expect((await getService(owner.organizationId, service.id)).needsRedeploy).toBe(false);

    // A later change flips the flag again.
    await variableRequest(owner.cookie, service.id, variable.id, {
      method: "PATCH",
      body: { value: "rotated-value" },
    });
    expect((await getService(owner.organizationId, service.id)).needsRedeploy).toBe(true);
  });

  it("records AuditEvents with the key but never the value", async () => {
    const owner = await signUp(uniqueName("envaudit") + "@example.test", uniqueName("envaudit"));
    const project = await createProject(owner.cookie, "Env Audit");
    const service = await createService(owner.cookie, project.id, "Audited App");

    const createdResponse = await variablesRequest(owner.cookie, service.id, {
      method: "POST",
      body: { key: "AUDIT_TOKEN", value: SECRET_VALUE },
    });
    const created = ((await createdResponse.json()) as { data: VariableBody }).data;

    await revealRequest(owner.cookie, service.id, created.id);
    await variableRequest(owner.cookie, service.id, created.id, {
      method: "PATCH",
      body: { value: "rotated" },
    });
    await variableRequest(owner.cookie, service.id, created.id, { method: "DELETE" });

    const events = await queryRows<{ action: string; details: Record<string, unknown> }>(
      'SELECT "action", "details" FROM "audit_event" WHERE "organizationId" = $1 AND "action" LIKE $2 ORDER BY "createdAt"',
      [owner.organizationId, "environment_variable.%"],
    );
    expect(events.map((event) => event.action)).toEqual([
      "environment_variable.created",
      "environment_variable.revealed",
      "environment_variable.updated",
      "environment_variable.deleted",
    ]);

    // No event carries the value or the ciphertext.
    for (const event of events) {
      expect(JSON.stringify(event.details)).not.toContain(SECRET_VALUE);
      expect(JSON.stringify(event.details)).not.toContain("v1.");
      expect(event.details).toHaveProperty("serviceId", service.id);
    }
  });

  it("removes Environment Variables when the Service is deleted", async () => {
    const owner = await signUp(
      uniqueName("envcascade") + "@example.test",
      uniqueName("envcascade"),
    );
    const project = await createProject(owner.cookie, "Env Cascade");
    const service = await createService(owner.cookie, project.id, "Cascade App");

    const createdResponse = await variablesRequest(owner.cookie, service.id, {
      method: "POST",
      body: { key: "GOING_AWAY", value: "x" },
    });
    expect(createdResponse.status).toBe(201);

    const removed = await serviceDeleteRequest(owner.cookie, service.id, "Cascade App");
    expect(removed.status).toBe(200);

    const rows = await queryRows<{ id: string }>(
      'SELECT "id" FROM "environment_variable" WHERE "serviceId" = $1',
      [service.id],
    );
    expect(rows).toHaveLength(0);
  });
});
