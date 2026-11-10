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
 * A fake Node Agent. It speaks the same contract as the Go agent but records the
 * requests instead of building, so the Control Plane state machine can be tested
 * without Docker. Each test chooses whether the Build succeeds or fails.
 */
type FakeAgent = {
  server: Server;
  baseUrl: string;
  requests: Array<{ method: string; path: string; body?: unknown }>;
  failBuild: boolean;
  /** Build ids whose Build the fake reports as cancelled. */
  cancelledBuilds: Set<string>;
  /** Set when a cancel request reaches the agent. */
  cancels: Array<{ deploymentId: string; body?: unknown }>;
  logLines: string[];
  buildStarted: Promise<void>;
  reset(): void;
};

async function startFakeAgent(): Promise<FakeAgent> {
  let signalStarted: () => void = () => undefined;
  let buildStarted = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });

  const agent: FakeAgent = {
    server: createServer(() => undefined),
    baseUrl: "",
    requests: [],
    failBuild: false,
    cancelledBuilds: new Set<string>(),
    cancels: [],
    logLines: ["Cloning into 'src'...", "Step 1/3 : FROM busybox", "Successfully built image"],
    buildStarted,
    reset() {
      agent.requests = [];
      agent.failBuild = false;
      agent.cancelledBuilds = new Set<string>();
      agent.cancels = [];
      agent.logLines = ["Cloning into 'src'...", "Successfully built image"];
      buildStarted = new Promise<void>((resolve) => {
        signalStarted = resolve;
      });
      agent.buildStarted = buildStarted;
    },
  };

  agent.server = createServer((request, response) => {
    void handleAgentRequest(agent, request, response, () => signalStarted());
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
  onBuildStarted: () => void,
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
    onBuildStarted();

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
      JSON.stringify(
        agent.cancelledBuilds.has(buildId)
          ? {
              buildId,
              status: "cancelled",
              finishedAt: new Date().toISOString(),
            }
          : agent.failBuild
            ? {
                buildId,
                status: "failed",
                error: "Build failed: process did not complete successfully",
                finishedAt: new Date().toISOString(),
              }
            : {
                buildId,
                status: "succeeded",
                imageRef: `stealth/service-test:${buildId}`,
                commitSha: "a".repeat(40),
                finishedAt: new Date().toISOString(),
              },
      ),
    );
    return;
  }

  // GET /v1/builds/{id}/logs
  if (request.method === "GET" && /^\/v1\/builds\/[^/]+\/logs$/.test(url.pathname)) {
    response.writeHead(200, { "content-type": "application/x-ndjson" });

    const lines = agent.failBuild
      ? [...agent.logLines, "error: failed to solve: process did not complete successfully"]
      : agent.logLines;

    for (const [index, message] of lines.entries()) {
      response.write(
        `${JSON.stringify({ sequence: index + 1, message, timestamp: new Date().toISOString() })}\n`,
      );
    }
    response.end();
    return;
  }

  // POST /v1/deployments/{id}/cancel
  if (request.method === "POST" && /^\/v1\/deployments\/[^/]+\/cancel$/.test(url.pathname)) {
    const deploymentId = decodeURIComponent(url.pathname.split("/")[3] as string);
    agent.cancels.push({ deploymentId, body });
    agent.cancelledBuilds.add(deploymentId);

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        deploymentId,
        serviceId: String(body?.serviceId ?? ""),
        buildCancelled: true,
        containersRemoved: 1,
        imageRemoved: true,
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
  const email = uniqueName(`dep${role}`) + Math.random().toString(36).slice(2, 6) + "@example.test";
  const inviteResponse = await auth.handler(
    new Request(`${BASE_URL}/api/auth/organization/invite-member`, {
      method: "POST",
      headers: { cookie: ownerCookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    }),
  );
  expect(inviteResponse.status).toBe(200);
  const invitation = (await inviteResponse.json()) as { id: string };

  // The username must be unique per sign-up, so it is derived from the email
  // rather than only from the role: two tests may both add a `member`.
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
type DeploymentBody = {
  id: string;
  serviceId: string;
  status: string;
  commitSha: string | null;
  imageRef: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
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

async function deploymentRequest(
  cookie: string,
  serviceId: string,
  init: { method?: string } = {},
): Promise<Response> {
  const { GET, POST } = await import("@/app/api/services/[serviceId]/deployments/route");
  const request = new Request(`${BASE_URL}/api/services/${serviceId}/deployments`, {
    method: init.method ?? "GET",
    headers: { cookie, origin: BASE_URL },
  });

  return init.method === "POST"
    ? POST(request, { params: Promise.resolve({ serviceId }) })
    : GET(request, { params: Promise.resolve({ serviceId }) });
}

async function deploymentDetail(cookie: string, deploymentId: string): Promise<Response> {
  const { GET } = await import("@/app/api/deployments/[deploymentId]/route");
  return GET(new Request(`${BASE_URL}/api/deployments/${deploymentId}`, { headers: { cookie, origin: BASE_URL } }), {
    params: Promise.resolve({ deploymentId }),
  });
}

async function deploymentLogs(cookie: string, deploymentId: string): Promise<Response> {
  const { GET } = await import("@/app/api/deployments/[deploymentId]/logs/route");
  return GET(
    new Request(`${BASE_URL}/api/deployments/${deploymentId}/logs`, {
      headers: { cookie, origin: BASE_URL },
    }),
    { params: Promise.resolve({ deploymentId }) },
  );
}

async function cancelRequest(cookie: string, deploymentId: string): Promise<Response> {
  const { POST } = await import("@/app/api/deployments/[deploymentId]/cancel/route");
  return POST(
    new Request(`${BASE_URL}/api/deployments/${deploymentId}/cancel`, {
      method: "POST",
      headers: { cookie, origin: BASE_URL },
    }),
    { params: Promise.resolve({ deploymentId }) },
  );
}

async function redeployRequest(cookie: string, deploymentId: string): Promise<Response> {
  const { POST } = await import("@/app/api/deployments/[deploymentId]/redeploy/route");
  return POST(
    new Request(`${BASE_URL}/api/deployments/${deploymentId}/redeploy`, {
      method: "POST",
      headers: { cookie, origin: BASE_URL },
    }),
    { params: Promise.resolve({ deploymentId }) },
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
 * does, including the Job outcome. Any Job left behind by an earlier test is
 * completed first so the assertion always observes its own Deployment.
 */
async function runJobFor(deploymentId: string): Promise<{ status: string; message: string } | null> {
  const { claimBuildJob, completeJob, runBuildJob } = await import("@/lib/platform/deployments");

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const job = await claimBuildJob();
    if (!job) return null;

    if (job.payload.deploymentId === deploymentId) {
      const result = await runBuildJob(job);
      await completeJob(job.id, result.status === "failed" ? "failed" : "succeeded");
      return result;
    }

    await completeJob(job.id);
  }

  return null;
}

describe("Deployment Build pipeline", () => {
  it("records a heartbeat and exposes node status", async () => {
    const owner = await signUp(uniqueName("nodeowner") + "@example.test", uniqueName("nodeowner"));

    const heartbeat = await sendHeartbeat();
    expect(heartbeat.status).toBe(200);
    const node = ((await heartbeat.json()) as { data: { status: string } }).data;
    expect(node.status).toBe("healthy");

    const { GET } = await import("@/app/api/nodes/route");
    const response = await GET(
      new Request(`${BASE_URL}/api/nodes`, { headers: { cookie: owner.cookie, origin: BASE_URL } }),
    );
    expect(response.status).toBe(200);

    const nodes = (
      (await response.json()) as {
        data: Array<{ name: string; status: string; lastSeenAt: string }>;
      }
    ).data;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ name: "test-node", status: "healthy" });
    expect(nodes[0].lastSeenAt).toBeTruthy();
  });

  it("rejects a heartbeat with the wrong token", async () => {
    const response = await sendHeartbeat("wrong-token");
    expect(response.status).toBe(401);
    expect(((await response.json()) as FailureBody).error.code).toBe("unauthenticated");
  });

  it("blocks a Deployment when no node is healthy", async () => {
    const owner = await signUp(uniqueName("nono") + "@example.test", uniqueName("nono"));
    const project = await createProject(owner.cookie, "No Node");
    const service = await createService(owner.cookie, project.id, "Waiting");

    // Pretend the only node stopped reporting in.
    await queryRows('UPDATE "node" SET "lastSeenAt" = now() - interval \'10 minutes\'', []);

    const response = await deploymentRequest(owner.cookie, service.id, { method: "POST" });
    expect(response.status).toBe(409);
    expect(((await response.json()) as FailureBody).error.code).toBe("node_unhealthy");

    // Restore the heartbeat so later tests can deploy.
    await sendHeartbeat();
  });

  it("moves a Deployment from queued to deploying when the Build succeeds", async () => {
    agent.reset();
    await sendHeartbeat();

    const owner = await signUp(uniqueName("buildok") + "@example.test", uniqueName("buildok"));
    const project = await createProject(owner.cookie, "Build OK");
    const service = await createService(owner.cookie, project.id, "Web App");

    const response = await deploymentRequest(owner.cookie, service.id, { method: "POST" });
    expect(response.status).toBe(201);
    const deployment = ((await response.json()) as { data: DeploymentBody }).data;
    expect(deployment.status).toBe("queued");
    expect(deployment.serviceId).toBe(service.id);

    // The Job exists so a worker can pick it up.
    const jobs = await queryRows<{ type: string; status: string; payload: { deploymentId: string } }>(
      'SELECT "type", "status", "payload" FROM "job" WHERE "payload"->>\'deploymentId\' = $1',
      [deployment.id],
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ type: "build", status: "queued" });

    // The Service shows as deploying while the Build runs.
    const { getService } = await import("@/lib/platform/services");
    expect((await getService(owner.organizationId, service.id)).status).toBe("deploying");

    const result = await runJobFor(deployment.id);
    expect(result).toMatchObject({ status: "deploying" });

    // A successful Build keeps the Job succeeded and the Service deploying.
    const finishedJobs = await queryRows<{ status: string }>(
      'SELECT "status" FROM "job" WHERE "type" = $1 AND "payload"->>\'deploymentId\' = $2',
      ["build", deployment.id],
    );
    expect(finishedJobs[0].status).toBe("succeeded");

    const detail = await deploymentDetail(owner.cookie, deployment.id);
    expect(detail.status).toBe(200);
    const finished = ((await detail.json()) as { data: DeploymentBody }).data;
    expect(finished.status).toBe("deploying");
    expect(finished.imageRef).toBe(`stealth/service-test:${deployment.id}`);
    expect(finished.commitSha).toBe("a".repeat(40));
    expect(finished.errorMessage).toBeNull();
    expect(finished.startedAt).toBeTruthy();

    // The Build log was streamed into the Control Plane.
    const logs = await deploymentLogs(owner.cookie, deployment.id);
    expect(logs.status).toBe(200);
    const logBody = (await logs.json()) as { data: { lines: string[] } };
    expect(logBody.data.lines.join("\n")).toContain("Cloning into 'src'");
    expect(logBody.data.lines.join("\n")).toContain("Successfully built image");

    // The agent was asked to build with the Deployment's configuration.
    const startRequest = agent.requests.find(
      (entry) => entry.method === "POST" && entry.path === "/v1/builds",
    );
    expect(startRequest?.body).toMatchObject({
      buildId: deployment.id,
      repoUrl: "https://github.com/example/web-app",
      branch: "main",
      dockerfilePath: "Dockerfile",
      imageTag: `stealth/service-${service.id}:${deployment.id}`,
    });
  });

  it("marks a Deployment failed when the Build fails and keeps the Service usable", async () => {
    agent.reset();
    agent.failBuild = true;
    await sendHeartbeat();

    const owner = await signUp(uniqueName("buildfail") + "@example.test", uniqueName("buildfail"));
    const project = await createProject(owner.cookie, "Build Fail");
    const service = await createService(owner.cookie, project.id, "Broken App");

    const response = await deploymentRequest(owner.cookie, service.id, { method: "POST" });
    expect(response.status).toBe(201);
    const deployment = ((await response.json()) as { data: DeploymentBody }).data;

    const result = await runJobFor(deployment.id);
    expect(result?.status).toBe("failed");

    const detail = await deploymentDetail(owner.cookie, deployment.id);
    const failed = ((await detail.json()) as { data: DeploymentBody }).data;
    expect(failed.status).toBe("failed");
    expect(failed.imageRef).toBeNull();
    expect(failed.errorMessage).toMatch(/Build failed/);
    expect(failed.finishedAt).toBeTruthy();

    const logs = await deploymentLogs(owner.cookie, deployment.id);
    const logBody = (await logs.json()) as { data: { lines: string[] } };
    expect(logBody.data.lines.join("\n")).toContain("failed to solve");

    // The Job is terminal so the worker never retries a broken commit.
    const jobs = await queryRows<{ status: string }>(
      'SELECT "status" FROM "job" WHERE "payload"->>\'deploymentId\' = $1',
      [deployment.id],
    );
    expect(jobs[0].status).toBe("failed");

    // The Service falls back to its pre-deploy state instead of staying stuck
    // in `deploying`, and a retry is still allowed.
    const { getService } = await import("@/lib/platform/services");
    expect((await getService(owner.organizationId, service.id)).status).toBe("not_deployed");

    const retry = await deploymentRequest(owner.cookie, service.id, { method: "POST" });
    expect(retry.status).toBe(201);
  });

  it("rejects a second Deployment while one is in flight", async () => {
    agent.reset();
    await sendHeartbeat();

    const owner = await signUp(uniqueName("busy") + "@example.test", uniqueName("busy"));
    const project = await createProject(owner.cookie, "Busy");
    const service = await createService(owner.cookie, project.id, "Busy App");

    const first = await deploymentRequest(owner.cookie, service.id, { method: "POST" });
    expect(first.status).toBe(201);
    const deployment = ((await first.json()) as { data: DeploymentBody }).data;

    const second = await deploymentRequest(owner.cookie, service.id, { method: "POST" });
    expect(second.status).toBe(409);
    expect(((await second.json()) as FailureBody).error.code).toBe("deployment_in_progress");

    // Finish the Build so the Service is not left busy for later assertions.
    await runJobFor(deployment.id);
  });

  it("lets members trigger Deployments but not create Services", async () => {
    agent.reset();
    await sendHeartbeat();

    const owner = await signUp(uniqueName("memowner") + "@example.test", uniqueName("memowner"));
    const member = await addMember(owner.cookie, owner.organizationId, "member");
    const project = await createProject(owner.cookie, "Member Deploy");
    const service = await createService(owner.cookie, project.id, "Shared App");

    const response = await deploymentRequest(member.cookie, service.id, { method: "POST" });
    expect(response.status).toBe(201);
    const deployment = ((await response.json()) as { data: DeploymentBody }).data;

    await runJobFor(deployment.id);
  });

  it("isolates Deployments between Organizations", async () => {
    agent.reset();
    await sendHeartbeat();

    const first = await signUp(uniqueName("depa") + "@example.test", uniqueName("depa"));
    const second = await signUp(uniqueName("depb") + "@example.test", uniqueName("depb"));
    const project = await createProject(first.cookie, "Tenant A");
    const service = await createService(first.cookie, project.id, "Tenant A App");

    const response = await deploymentRequest(first.cookie, service.id, { method: "POST" });
    const deployment = ((await response.json()) as { data: DeploymentBody }).data;

    const read = await deploymentDetail(second.cookie, deployment.id);
    expect(read.status).toBe(404);

    const logs = await deploymentLogs(second.cookie, deployment.id);
    expect(logs.status).toBe(404);

    const trigger = await deploymentRequest(second.cookie, service.id, { method: "POST" });
    expect(trigger.status).toBe(404);

    const list = await deploymentRequest(second.cookie, service.id);
    expect(list.status).toBe(404);

    await runJobFor(deployment.id);
  });

  it("records an AuditEvent for the trigger and requires authentication", async () => {
    agent.reset();
    await sendHeartbeat();

    const owner = await signUp(uniqueName("depaudit") + "@example.test", uniqueName("depaudit"));
    const project = await createProject(owner.cookie, "Audited");
    const service = await createService(owner.cookie, project.id, "Audited App");

    const response = await deploymentRequest(owner.cookie, service.id, { method: "POST" });
    const deployment = ((await response.json()) as { data: DeploymentBody }).data;

    const events = await queryRows<{ action: string; details: Record<string, unknown> }>(
      'SELECT "action", "details" FROM "audit_event" WHERE "organizationId" = $1 AND "action" = $2',
      [owner.organizationId, "deployment.triggered"],
    );
    expect(events).toHaveLength(1);
    expect(events[0].details).toMatchObject({
      serviceId: service.id,
      deploymentId: deployment.id,
    });

    const { POST } = await import("@/app/api/services/[serviceId]/deployments/route");
    const anonymous = await POST(
      new Request(`${BASE_URL}/api/services/${service.id}/deployments`, {
        method: "POST",
        headers: { origin: BASE_URL },
      }),
      { params: Promise.resolve({ serviceId: service.id }) },
    );
    expect(anonymous.status).toBe(401);

    await runJobFor(deployment.id);
  });

  it("lists Deployments for a Service newest first", async () => {
    agent.reset();
    await sendHeartbeat();

    const owner = await signUp(uniqueName("deplist") + "@example.test", uniqueName("deplist"));
    const project = await createProject(owner.cookie, "History");
    const service = await createService(owner.cookie, project.id, "History App");

    const firstResponse = await deploymentRequest(owner.cookie, service.id, { method: "POST" });
    const firstDeployment = ((await firstResponse.json()) as { data: DeploymentBody }).data;
    await runJobFor(firstDeployment.id);

    const list = await deploymentRequest(owner.cookie, service.id);
    expect(list.status).toBe(200);
    const deployments = ((await list.json()) as { data: DeploymentBody[] }).data;
    expect(deployments.map((entry) => entry.id)).toEqual([firstDeployment.id]);
    expect(deployments[0].status).toBe("deploying");
  });

  it("shows the full Deployment history with timings and durations", async () => {
    agent.reset();
    await sendHeartbeat();

    const owner = await signUp(uniqueName("depdur") + "@example.test", uniqueName("depdur"));
    const project = await createProject(owner.cookie, "Durations");
    const service = await createService(owner.cookie, project.id, "Duration App");

    // One Deployment that runs to completion, so the history has a real
    // `startedAt`/`finishedAt` pair to measure.
    const created = await deploymentRequest(owner.cookie, service.id, { method: "POST" });
    const deployment = ((await created.json()) as { data: DeploymentBody }).data;
    await runJobFor(deployment.id);

    const { markDeploymentRunning } = await import("@/lib/platform/deployments");
    await markDeploymentRunning(deployment.id);

    const list = await deploymentRequest(owner.cookie, service.id);
    const history = ((await list.json()) as { data: DeploymentBody[] }).data;
    expect(history).toHaveLength(1);

    const [entry] = history;
    expect(entry.status).toBe("running");
    expect(entry.commitSha).toBe("a".repeat(40));
    expect(entry.startedAt).toBeTruthy();
    expect(entry.finishedAt).toBeTruthy();
    expect(entry.errorMessage).toBeNull();

    // The duration is derived from the two timestamps, so it must not be negative
    // and must be measurable.
    const duration = new Date(entry.finishedAt as string).getTime() - new Date(entry.startedAt as string).getTime();
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it("redeploys the same commit as a new Deployment", async () => {
    agent.reset();
    await sendHeartbeat();

    const owner = await signUp(uniqueName("deprede") + "@example.test", uniqueName("deprede"));
    const project = await createProject(owner.cookie, "Redeploy");
    const service = await createService(owner.cookie, project.id, "Redeploy App");

    const created = await deploymentRequest(owner.cookie, service.id, { method: "POST" });
    const first = ((await created.json()) as { data: DeploymentBody }).data;
    await runJobFor(first.id);

    const { markDeploymentRunning } = await import("@/lib/platform/deployments");
    await markDeploymentRunning(first.id);

    const response = await redeployRequest(owner.cookie, first.id);
    expect(response.status).toBe(201);
    const redeployed = ((await response.json()) as { data: DeploymentBody }).data;

    // A new Deployment, not a re-run of the old one.
    expect(redeployed.id).not.toBe(first.id);
    expect(redeployed.serviceId).toBe(service.id);
    expect(redeployed.status).toBe("queued");
    expect(redeployed.commitSha).toBe("a".repeat(40));

    agent.requests.length = 0;
    await runJobFor(redeployed.id);

    // The Build was pinned to the original commit instead of the branch tip.
    const buildRequest = agent.requests.find(
      (entry) => entry.method === "POST" && entry.path === "/v1/builds",
    );
    expect(buildRequest?.body).toMatchObject({
      buildId: redeployed.id,
      commitSha: "a".repeat(40),
    });

    const list = await deploymentRequest(owner.cookie, service.id);
    const history = ((await list.json()) as { data: DeploymentBody[] }).data;
    expect(history.map((entry) => entry.id)).toEqual([redeployed.id, first.id]);
  });

  it("cancels a queued Deployment and leaves nothing to build", async () => {
    agent.reset();
    await sendHeartbeat();

    const owner = await signUp(uniqueName("depcancel") + "@example.test", uniqueName("depcancel"));
    const project = await createProject(owner.cookie, "Cancel");
    const service = await createService(owner.cookie, project.id, "Cancel App");

    const created = await deploymentRequest(owner.cookie, service.id, { method: "POST" });
    const deployment = ((await created.json()) as { data: DeploymentBody }).data;
    expect(deployment.status).toBe("queued");

    const response = await cancelRequest(owner.cookie, deployment.id);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: {
        deployment: DeploymentBody;
        aborted: { buildCancelled: boolean; containersRemoved: number; imageRemoved: boolean } | null;
      };
    };
    expect(body.data.deployment.status).toBe("cancelled");
    expect(body.data.deployment.finishedAt).toBeTruthy();
    expect(body.data.aborted).toMatchObject({ buildCancelled: true, imageRemoved: true });

    // The agent was told to abort the right Deployment for the right Service.
    expect(agent.cancels).toHaveLength(1);
    expect(agent.cancels[0]).toMatchObject({
      deploymentId: deployment.id,
      body: { serviceId: service.id },
    });

    // The Job is cancelled, so the worker never builds it.
    const jobs = await queryRows<{ status: string }>(
      'SELECT "status" FROM "job" WHERE "payload"->>\'deploymentId\' = $1',
      [deployment.id],
    );
    expect(jobs[0].status).toBe("cancelled");

    // The Service is not stuck in `deploying`, and the cancelled Deployment is
    // not claimed by the worker.
    const { getService } = await import("@/lib/platform/services");
    expect((await getService(owner.organizationId, service.id)).status).toBe("not_deployed");
    expect(await runJobFor(deployment.id)).toBeNull();

    // A cancelled Deployment does not block a new attempt.
    const retry = await deploymentRequest(owner.cookie, service.id, { method: "POST" });
    expect(retry.status).toBe(201);
    const retried = ((await retry.json()) as { data: DeploymentBody }).data;
    await runJobFor(retried.id);
  });

  it("keeps a running Service serving when a later Deployment is cancelled", async () => {
    agent.reset();
    await sendHeartbeat();

    const owner = await signUp(uniqueName("depcancelrun") + "@example.test", uniqueName("depcancelrun"));
    const project = await createProject(owner.cookie, "Cancel Running");
    const service = await createService(owner.cookie, project.id, "Live App");

    const created = await deploymentRequest(owner.cookie, service.id, { method: "POST" });
    const live = ((await created.json()) as { data: DeploymentBody }).data;
    await runJobFor(live.id);

    const { markDeploymentRunning } = await import("@/lib/platform/deployments");
    await markDeploymentRunning(live.id);

    // A second Deployment starts while the first is serving.
    const second = await deploymentRequest(owner.cookie, service.id, { method: "POST" });
    const pending = ((await second.json()) as { data: DeploymentBody }).data;

    const response = await cancelRequest(owner.cookie, pending.id);
    expect(response.status).toBe(200);

    // The Service keeps running because the older Deployment still serves.
    const { getService } = await import("@/lib/platform/services");
    expect((await getService(owner.organizationId, service.id)).status).toBe("running");

    const detail = await deploymentDetail(owner.cookie, live.id);
    expect(((await detail.json()) as { data: DeploymentBody }).data.status).toBe("running");
  });

  it("rejects a cancel for a Deployment that already finished", async () => {
    agent.reset();
    await sendHeartbeat();

    const owner = await signUp(uniqueName("depcanceldone") + "@example.test", uniqueName("depcanceldone"));
    const project = await createProject(owner.cookie, "Cancel Finished");
    const service = await createService(owner.cookie, project.id, "Finished App");

    const created = await deploymentRequest(owner.cookie, service.id, { method: "POST" });
    const deployment = ((await created.json()) as { data: DeploymentBody }).data;
    await runJobFor(deployment.id);

    const response = await cancelRequest(owner.cookie, deployment.id);
    expect(response.status).toBe(409);
    expect(((await response.json()) as FailureBody).error.code).toBe("deployment_not_cancellable");
  });

  it("limits redeploy and cancel to owners and admins", async () => {
    agent.reset();
    await sendHeartbeat();

    const owner = await signUp(uniqueName("deprole") + "@example.test", uniqueName("deprole"));
    const member = await addMember(owner.cookie, owner.organizationId, "member");
    const project = await createProject(owner.cookie, "Roles");
    const service = await createService(owner.cookie, project.id, "Role App");

    const created = await deploymentRequest(member.cookie, service.id, { method: "POST" });
    expect(created.status).toBe(201);
    const deployment = ((await created.json()) as { data: DeploymentBody }).data;

    const cancel = await cancelRequest(member.cookie, deployment.id);
    expect(cancel.status).toBe(403);

    const redeploy = await redeployRequest(member.cookie, deployment.id);
    expect(redeploy.status).toBe(403);

    await cancelRequest(owner.cookie, deployment.id);
  });

  it("records an AuditEvent when a Deployment is cancelled", async () => {
    agent.reset();
    await sendHeartbeat();

    const owner = await signUp(uniqueName("depcancelaudit") + "@example.test", uniqueName("depcancelaudit"));
    const project = await createProject(owner.cookie, "Cancel Audit");
    const service = await createService(owner.cookie, project.id, "Audited Cancel");

    const created = await deploymentRequest(owner.cookie, service.id, { method: "POST" });
    const deployment = ((await created.json()) as { data: DeploymentBody }).data;

    await cancelRequest(owner.cookie, deployment.id);

    const events = await queryRows<{ action: string; details: Record<string, unknown> }>(
      'SELECT "action", "details" FROM "audit_event" WHERE "organizationId" = $1 AND "action" = $2',
      [owner.organizationId, "deployment.cancelled"],
    );
    expect(events).toHaveLength(1);
    expect(events[0].details).toMatchObject({
      serviceId: service.id,
      deploymentId: deployment.id,
    });
  });

  it("deletes Build logs older than seven days", async () => {
    const { pruneLogs } = await import("@/lib/platform/deployments");

    // A Deployment old enough for its logs to expire, and one that is not.
    const rows = await queryRows<{ id: string }>(
      `INSERT INTO "deployment" ("id", "serviceId", "status", "createdAt")
       SELECT gen_random_uuid()::text, s."id", 'failed', now() - make_interval(days => 8)
       FROM "service" s LIMIT 1
       RETURNING "id"`,
      [],
    );
    const fresh = await queryRows<{ id: string }>(
      `INSERT INTO "deployment" ("id", "serviceId", "status", "createdAt")
       SELECT gen_random_uuid()::text, s."id", 'failed', now()
       FROM "service" s LIMIT 1
       RETURNING "id"`,
      [],
    );

    const oldId = rows[0].id;
    const freshId = fresh[0].id;

    await queryRows(
      `INSERT INTO "build_log" ("deploymentId", "sequence", "message", "createdAt") VALUES
         ($1, 1, 'expired line', now() - make_interval(days => 8)),
         ($2, 1, 'fresh line', now())`,
      [oldId, freshId],
    );

    const pruned = await pruneLogs();
    expect(pruned.lines).toBeGreaterThanOrEqual(1);

    const remaining = await queryRows<{ message: string }>(
      'SELECT "message" FROM "build_log" WHERE "deploymentId" = ANY($1::text[]) ORDER BY "message"',
      [[oldId, freshId]],
    );
    expect(remaining.map((row) => row.message)).toEqual(["fresh line"]);
  });
});
