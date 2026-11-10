import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDatabase } from "../helpers/database";

const BASE_URL = "http://localhost:3000";
const PASSWORD = "password-12345";
const RUN_ID = Math.random().toString(36).slice(2, 8);
const AGENT_TOKEN = "test-agent-token";
const SECRET_VALUE = "sk-live-supersecret-value-1234";
const DATABASE_PASSWORD = "db-password-hunter2";

function uniqueName(base: string): string {
  return `${base}${RUN_ID}`;
}

type Auth = (typeof import("@/lib/auth"))["auth"];
type ScansModule = typeof import("@/lib/platform/scans");
type ScanFindingList = import("@/lib/platform/scans").ScanFindingList;
type ScanFindingSummary = import("@/lib/platform/scans").ScanFindingSummary;

let auth: Auth;
let scans: ScansModule;

/**
 * A fake Node Agent that answers the Scan call with a fixed report. Trivy is
 * described as finding a critical vulnerability; ClamAV as matching a high
 * severity malware signature, which is what makes a finding urgent.
 */
type FakeAgent = {
  server: Server;
  baseUrl: string;
  requests: Array<{ method: string; path: string; body?: unknown }>;
  failScans: boolean;
  reset(): void;
};

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function startFakeAgent(): Promise<FakeAgent> {
  const agent: FakeAgent = {
    server: createServer(() => undefined),
    baseUrl: "",
    requests: [],
    failScans: false,
    reset() {
      agent.requests = [];
      agent.failScans = false;
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

const SCAN_REPORT = {
  deploymentId: "filled-in-by-handler",
  findings: [
    {
      scanner: "trivy",
      severity: "critical",
      title: "CVE-2024-0001 in libssl",
      details: {
        kind: "vulnerability",
        package: "libssl",
        installedVersion: "3.1.0",
        fixedVersion: "3.1.4",
      },
    },
    {
      scanner: "clamav",
      severity: "high",
      title: "Unix.Trojan.Test-1",
      details: { kind: "malware", path: "/usr/bin/tool" },
    },
  ],
};

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

  if (request.method === "POST" && url.pathname === "/v1/scans") {
    if (agent.failScans) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "scan_failed" }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ...SCAN_REPORT, deploymentId: body?.deploymentId }));
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
  scans = await import("@/lib/platform/scans");

  await queryRows('DELETE FROM "job" WHERE "type" = $1', [scans.SCAN_JOB_TYPE]);
  await queryRows('DELETE FROM "scan_finding"', []);

  fixture = await createFixture();
});

afterAll(async () => {
  if (agent) {
    await new Promise<void>((resolve) => agent.server.close(() => resolve()));
  }
});

type SignUpResult = { cookie: string; userId: string; organizationId: string; email: string };

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
    email,
  };
}

type Fixture = {
  owner: SignUpResult;
  outsider: SignUpResult;
  projectId: string;
  serviceId: string;
  databaseId: string;
  deploymentId: string;
  imageRef: string;
};

let fixture: Fixture;

async function createFixture(): Promise<Fixture> {
  const ownerEmail = uniqueName("scanowner") + "@example.test";
  const outsiderEmail = uniqueName("scanother") + "@example.test";
  const owner = await signUp(ownerEmail, uniqueName("scanowner"));
  const outsider = await signUp(outsiderEmail, uniqueName("scanother"));

  const { POST: createProject } = await import("@/app/api/projects/route");
  const projectResponse = await createProject(
    new Request(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { cookie: owner.cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ name: "Scan Project" }),
    }),
  );
  expect(projectResponse.status).toBe(201);
  const project = ((await projectResponse.json()) as { data: { id: string } }).data;

  const { POST: createService } = await import("@/app/api/projects/[projectId]/services/route");
  const serviceResponse = await createService(
    new Request(`${BASE_URL}/api/projects/${project.id}/services`, {
      method: "POST",
      headers: { cookie: owner.cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Scanned App",
        repoUrl: "https://github.com/example/web-app",
        branch: "main",
      }),
    }),
    { params: Promise.resolve({ projectId: project.id }) },
  );
  expect(serviceResponse.status).toBe(201);
  const service = ((await serviceResponse.json()) as { data: { id: string } }).data;

  // A secret Environment Variable and a Database exist so the tests can prove
  // their values never reach the findings response.
  await queryRows(
    `INSERT INTO "environment_variable" ("id", "serviceId", "key", "valueCiphertext")
     VALUES (gen_random_uuid()::text, $1, 'API_TOKEN', 'sealed-secret-value')`,
    [service.id],
  );
  const database = await queryRows<{ id: string }>(
    `INSERT INTO "database" ("id", "projectId", "encryptedPassword", "status")
     VALUES (gen_random_uuid()::text, $1, 'sealed-database-password', 'running')
     RETURNING "id"`,
    [project.id],
  );

  const deploymentId = crypto.randomUUID();
  const imageRef = `stealth/service-${service.id}:${deploymentId}`;
  await queryRows(
    `INSERT INTO "deployment" ("id", "serviceId", "status", "imageRef", "commitSha")
     VALUES ($1, $2, 'running', $3, $4)`,
    [deploymentId, service.id, imageRef, "a".repeat(40)],
  );

  return {
    owner,
    outsider,
    projectId: project.id,
    serviceId: service.id,
    databaseId: database[0].id,
    deploymentId,
    imageRef,
  };
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

async function findingsRequest(
  cookie: string,
  query = "",
): Promise<Response> {
  const { GET } = await import("@/app/api/admin/findings/route");

  return GET(
    new Request(`${BASE_URL}/api/admin/findings${query}`, {
      headers: { cookie, origin: BASE_URL },
    }),
  );
}

async function storedFindings(deploymentId: string): Promise<ScanFindingSummary[]> {
  const list = await scans.listFindings();

  return list.findings.filter((finding) => finding.deploymentId === deploymentId);
}

describe("Image scan findings", () => {
  it("queues a scan job for a Deployment", async () => {
    const queued = await scans.enqueueScanJob(fixture.deploymentId);
    expect(queued).toBe(true);

    // A second enqueue while the first is still queued is a no-op.
    const again = await scans.enqueueScanJob(fixture.deploymentId);
    expect(again).toBe(false);

    const jobs = await queryRows<{ id: string; type: string; status: string }>(
      'SELECT "id", "type", "status" FROM "job" WHERE "type" = $1',
      [scans.SCAN_JOB_TYPE],
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ type: "scan", status: "queued" });
  });

  it("stores Trivy and ClamAV findings and marks high-severity malware urgent", async () => {
    agent.reset();

    const result = await scans.runScanJob({
      id: "test-job",
      payload: { deploymentId: fixture.deploymentId },
    });
    expect(result.status).toBe("completed");

    // The agent was asked to scan the exact image the Deployment built.
    const scanRequests = agent.requests.filter((entry) => entry.path === "/v1/scans");
    expect(scanRequests).toHaveLength(1);
    expect(scanRequests[0].body).toMatchObject({
      deploymentId: fixture.deploymentId,
      imageRef: fixture.imageRef,
    });

    const findings = await storedFindings(fixture.deploymentId);
    expect(findings).toHaveLength(2);

    const vulnerability = findings.find((finding) => finding.scanner === "trivy");
    expect(vulnerability).toMatchObject({
      severity: "critical",
      title: "CVE-2024-0001 in libssl",
      urgent: false,
    });
    expect(vulnerability?.details).toMatchObject({ package: "libssl" });

    const malware = findings.find((finding) => finding.scanner === "clamav");
    expect(malware).toMatchObject({
      severity: "high",
      title: "Unix.Trojan.Test-1",
      urgent: true,
    });
    expect(malware?.details).toMatchObject({ kind: "malware" });

    // Findings carry the Deployment, Service, Project, and Organization context
    // a Platform Admin needs to triage without touching tenant data.
    expect(findings[0]).toMatchObject({
      organizationName: expect.any(String),
      projectName: "Scan Project",
      serviceName: "Scanned App",
      imageRef: fixture.imageRef,
    });

    // Every finding also appears in the admin list, urgent first.
    const list = await scans.listFindings();
    expect(list.urgent).toBe(1);
    expect(list.findings[0].urgent).toBe(true);
  });

  it("records a failed scan as an informational finding", async () => {
    agent.reset();
    agent.failScans = true;

    const run = scans.runScanJob({
      id: "test-job",
      payload: { deploymentId: fixture.deploymentId },
    });
    await expect(run).rejects.toThrow();

    const findings = await storedFindings(fixture.deploymentId);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      scanner: "trivy",
      severity: "info",
      title: "The image scan could not run",
      urgent: false,
    });
    expect(findings[0].details).toMatchObject({ kind: "scan_error" });

    // The Deployment itself is untouched: scanning is advisory.
    const deployments = await queryRows<{ status: string }>(
      'SELECT "status" FROM "deployment" WHERE "id" = $1',
      [fixture.deploymentId],
    );
    expect(deployments[0].status).toBe("running");
  });

  it("exposes findings across Organizations to a Platform Admin and hides secrets", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = fixture.outsider.email;
    agent.reset();
    await scans.runScanJob({
      id: "test-job",
      payload: { deploymentId: fixture.deploymentId },
    });

    const response = await findingsRequest(fixture.outsider.cookie);
    expect(response.status).toBe(200);

    const list = ((await response.json()) as { data: ScanFindingList }).data;
    expect(list.findings.length).toBeGreaterThanOrEqual(1);
    expect(list.findings.some((finding) => finding.deploymentId === fixture.deploymentId)).toBe(
      true,
    );

    // The admin is not a Member of the owner's Organization, so seeing these
    // findings proves the list is cross-Organization.
    const memberships = await queryRows(
      'SELECT 1 FROM "member" WHERE "userId" = $1 AND "organizationId" = $2',
      [fixture.outsider.userId, fixture.owner.organizationId],
    );
    expect(memberships).toHaveLength(0);

    // No response body may carry a secret value, a Database password, or the
    // encrypted ciphertexts.
    const body = JSON.stringify(list);
    expect(body).not.toContain("sealed-secret-value");
    expect(body).not.toContain("sealed-database-password");
    expect(body).not.toContain(SECRET_VALUE);
    expect(body).not.toContain(DATABASE_PASSWORD);
    expect(body).not.toContain("valueCiphertext");
    expect(body).not.toContain("encryptedPassword");

    // The urgent filter narrows the queue to malware.
    const urgentResponse = await findingsRequest(fixture.outsider.cookie, "?urgent=true");
    const urgent = ((await urgentResponse.json()) as { data: ScanFindingList }).data;
    expect(urgent.findings.length).toBeGreaterThanOrEqual(1);
    expect(urgent.findings.every((finding) => finding.urgent)).toBe(true);
  });

  it("rejects a user whose email is not a Platform Admin", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = fixture.outsider.email;

    const response = await findingsRequest(fixture.owner.cookie);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("forbidden");

    // Status is scoped to the signed-in email, not the other configured admin.
    const statusResponse = await fetchStatus(fixture.owner.cookie);
    expect(((await statusResponse.json()) as { data: { platformAdmin: boolean } }).data).toEqual({
      platformAdmin: false,
    });

    process.env.PLATFORM_ADMIN_EMAILS = "";

    const after = await findingsRequest(fixture.owner.cookie);
    expect(after.status).toBe(403);
  });

  it("reports the Platform Admin status for the sidebar", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = fixture.outsider.email;

    const status = await fetchStatus(fixture.outsider.cookie);
    expect(status.status).toBe(200);
    expect(((await status.json()) as { data: { platformAdmin: boolean } }).data).toEqual({
      platformAdmin: true,
    });

    process.env.PLATFORM_ADMIN_EMAILS = fixture.owner.email;
    const other = await fetchStatus(fixture.outsider.cookie);
    expect(((await other.json()) as { data: { platformAdmin: boolean } }).data).toEqual({
      platformAdmin: false,
    });
  });

  it("matches admin emails case-insensitively and ignores surrounding spaces", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = `  ${fixture.outsider.email.toUpperCase()} ,someone@example.test`;

    const status = await fetchStatus(fixture.outsider.cookie);
    expect(((await status.json()) as { data: { platformAdmin: boolean } }).data).toEqual({
      platformAdmin: true,
    });
  });
});

async function fetchStatus(cookie: string): Promise<Response> {
  const { GET } = await import("@/app/api/admin/status/route");

  return GET(
    new Request(`${BASE_URL}/api/admin/status`, {
      headers: { cookie, origin: BASE_URL },
    }),
  );
}
