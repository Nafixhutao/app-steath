import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
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
type RestoresModule = typeof import("@/lib/platform/restores");
type RestoreList = import("@/lib/platform/restores").RestoreList;
type RestoreSummary = import("@/lib/platform/restores").RestoreSummary;

let auth: Auth;
let restores: RestoresModule;

type AgentRequest = {
  method: string;
  path: string;
  search: string;
  contentType: string | string[] | undefined;
  body: string;
};

/**
 * A fake Node Agent. It records every lifecycle and Restore call so the tests
 * can assert which Services were stopped and what artifact was sent.
 */
type FakeAgent = {
  server: Server;
  baseUrl: string;
  requests: AgentRequest[];
  failRestores: boolean;
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
    failRestores: false,
    reset() {
      agent.requests = [];
      agent.failRestores = false;
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

async function handleAgentRequest(
  agent: FakeAgent,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://agent.test");
  const body = await readBody(request);

  if (request.headers.authorization !== `Bearer ${AGENT_TOKEN}`) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  agent.requests.push({
    method: request.method ?? "GET",
    path: url.pathname,
    search: url.search,
    contentType: request.headers["content-type"],
    body,
  });

  if (request.method === "POST" && url.pathname.startsWith("/v1/restores/")) {
    if (agent.failRestores) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "restore_failed" }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ restoreId: url.pathname.split("/").pop(), status: "completed" }));
    return;
  }

  const lifecycleMatch = /^\/v1\/services\/([^/]+)\/(stop|start|restart)$/.exec(url.pathname);
  if (lifecycleMatch && request.method === "POST") {
    const action = lifecycleMatch[2];
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        serviceId: decodeURIComponent(lifecycleMatch[1]),
        status: action === "stop" ? "stopped" : "running",
        containerId: "container-1",
        hostname: "app.example.test",
      }),
    );
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not found" }));
}

let agent: FakeAgent;
let localDir: string;

beforeAll(async () => {
  process.env.ENV_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  await prepareTestDatabase();
  process.env.BETTER_AUTH_URL = BASE_URL;
  process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
  process.env.AGENT_TOKEN = AGENT_TOKEN;

  agent = await startFakeAgent();
  process.env.AGENT_BASE_URL = agent.baseUrl;
  process.env.AGENT_NAME = "test-node";

  localDir = await mkdtemp(path.join(tmpdir(), "restore-local-"));
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_BUCKET;
  delete process.env.S3_REGION;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
  process.env.BACKUP_LOCAL_DIR = localDir;

  ({ auth } = await import("@/lib/auth"));
  restores = await import("@/lib/platform/restores");

  await queryRows('DELETE FROM "job" WHERE "type" = $1', [restores.RESTORE_JOB_TYPE]);
  await queryRows('DELETE FROM "restore"', []);

  fixture = await createFixture();
});

afterAll(async () => {
  if (agent) {
    await new Promise<void>((resolve) => agent.server.close(() => resolve()));
  }
  if (localDir) {
    await rm(localDir, { recursive: true, force: true });
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
  const email = uniqueName(`restore${role}`) + Math.random().toString(36).slice(2, 6) + "@example.test";
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

type Fixture = {
  owner: SignUpResult;
  projectId: string;
  services: Array<{ id: string; name: string }>;
  databaseId: string;
  volumeName: string;
};

let fixture: Fixture;

async function createFixture(): Promise<Fixture> {
  const owner = await signUp(uniqueName("restoreowner") + "@example.test", uniqueName("restoreowner"));

  const { POST: createProject } = await import("@/app/api/projects/route");
  const projectResponse = await createProject(
    new Request(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { cookie: owner.cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ name: "Restore Project" }),
    }),
  );
  expect(projectResponse.status).toBe(201);
  const project = ((await projectResponse.json()) as { data: { id: string } }).data;

  const { POST: createService } = await import("@/app/api/projects/[projectId]/services/route");
  const services: Array<{ id: string; name: string }> = [];
  for (const name of ["Restore App", "Other App"]) {
    const serviceResponse = await createService(
      new Request(`${BASE_URL}/api/projects/${project.id}/services`, {
        method: "POST",
        headers: { cookie: owner.cookie, origin: BASE_URL, "content-type": "application/json" },
        body: JSON.stringify({
          name,
          repoUrl: "https://github.com/example/web-app",
          branch: "main",
        }),
      }),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    expect(serviceResponse.status).toBe(201);
    services.push(((await serviceResponse.json()) as { data: { id: string; name: string } }).data);
  }

  // Both Services are running before the Restore, so the test can assert they
  // are stopped and started again around it.
  await queryRows('UPDATE "service" SET "status" = \'running\' WHERE "projectId" = $1', [
    project.id,
  ]);

  const database = await queryRows<{ id: string }>(
    `INSERT INTO "database" ("id", "projectId", "encryptedPassword", "status")
     VALUES (gen_random_uuid()::text, $1, 'sealed-password', 'running')
     RETURNING "id"`,
    [project.id],
  );

  const volumeName = `stealth-vol-${services[0].id}`;
  await queryRows(
    `INSERT INTO "volume" ("id", "serviceId", "dockerVolumeName", "mountPath")
     VALUES (gen_random_uuid()::text, $1, $2, '/data')`,
    [services[0].id, volumeName],
  );

  return {
    owner,
    projectId: project.id,
    services,
    databaseId: database[0].id,
    volumeName,
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

/**
 * Creates a completed Backup row and writes its artifact to the local Backup
 * directory, which is exactly the state a Restore finds after the daily run.
 */
async function createCompletedBackup(
  targetType: "database" | "volume",
  targetId: string,
  artifact: string,
): Promise<{ id: string; targetName: string }> {
  const extension = targetType === "volume" ? ".tar.gz" : ".dump";
  const rows = await queryRows<{ id: string }>(
    `INSERT INTO "backup" ("id", "organizationId", "projectId", "targetType", "targetId",
       "status", "storageProvider", "sizeBytes", "expiresAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 'completed', 'local', $5,
       now() + interval '7 days')
     RETURNING "id"`,
    [
      fixture.owner.organizationId,
      fixture.projectId,
      targetType,
      targetId,
      Buffer.byteLength(artifact),
    ],
  );
  const id = rows[0].id;
  const storageKey = `backups/${fixture.owner.organizationId}/${id}${extension}`;

  await queryRows('UPDATE "backup" SET "storageKey" = $2 WHERE "id" = $1', [id, storageKey]);

  const filePath = path.join(localDir, ...storageKey.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, artifact);

  return {
    id,
    targetName: targetType === "database" ? "PostgreSQL Database" : "Restore App Volume",
  };
}

async function restoreRequest(
  cookie: string,
  backupId: string,
  body: unknown,
): Promise<Response> {
  const { POST } = await import("@/app/api/backups/[backupId]/restore/route");

  return POST(
    new Request(`${BASE_URL}/api/backups/${backupId}/restore`, {
      method: "POST",
      headers: { cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ backupId }) },
  );
}

async function latestRestoreRow(restoreId: string): Promise<{
  status: string;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}> {
  const rows = await queryRows<{
    status: string;
    errorMessage: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
  }>(
    'SELECT "status", "errorMessage", "startedAt", "finishedAt" FROM "restore" WHERE "id" = $1',
    [restoreId],
  );
  expect(rows).toHaveLength(1);

  return rows[0];
}

async function serviceStatuses(): Promise<Record<string, string>> {
  const rows = await queryRows<{ id: string; status: string }>(
    'SELECT "id", "status" FROM "service" WHERE "projectId" = $1',
    [fixture.projectId],
  );

  return Object.fromEntries(rows.map((row) => [row.id, row.status]));
}

describe("Restore Backup", () => {
  it("restores a Database, stopping and starting every Service in the Project", async () => {
    const backup = await createCompletedBackup("database", fixture.databaseId, "database-dump");
    agent.reset();

    const response = await restoreRequest(fixture.owner.cookie, backup.id, {
      confirmation: backup.targetName,
    });
    expect(response.status).toBe(202);

    const created = ((await response.json()) as { data: RestoreSummary }).data;
    expect(created).toMatchObject({
      backupId: backup.id,
      targetType: "database",
      targetName: "PostgreSQL Database",
      projectName: "Restore Project",
      status: "pending",
    });

    // The Restore is queued as a Job the worker will claim.
    const jobs = await queryRows<{ payload: { restoreId: string } }>(
      'SELECT "payload" FROM "job" WHERE "type" = $1',
      [restores.RESTORE_JOB_TYPE],
    );
    expect(jobs.map((job) => job.payload.restoreId)).toContain(created.id);

    const result = await restores.runRestoreJob({ id: "test-job", payload: { restoreId: created.id } });
    expect(result.status).toBe("completed");

    const row = await latestRestoreRow(created.id);
    expect(row.status).toBe("completed");
    expect(row.errorMessage).toBeNull();
    expect(row.startedAt).not.toBeNull();
    expect(row.finishedAt).not.toBeNull();

    // Every Service in the Project was stopped, the artifact was sent, and the
    // Services were started again.
    const stopped = agent.requests.filter((entry) => entry.path.endsWith("/stop"));
    expect(stopped).toHaveLength(2);
    expect(stopped.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(
        fixture.services.map((service) => `/v1/services/${service.id}/stop`),
      ),
    );

    const sent = agent.requests.filter((entry) => entry.path.startsWith("/v1/restores/"));
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe("POST");
    expect(sent[0].contentType).toBe("application/octet-stream");
    expect(sent[0].body).toBe("database-dump");
    const query = new URLSearchParams(sent[0].search);
    expect(query.get("targetType")).toBe("database");
    expect(query.get("targetId")).toBe(fixture.databaseId);

    const started = agent.requests.filter((entry) => entry.path.endsWith("/start"));
    expect(started).toHaveLength(2);
    expect(await serviceStatuses()).toMatchObject(
      Object.fromEntries(fixture.services.map((service) => [service.id, "running"])),
    );

    // The request and the outcome are both AuditEvents with the actor.
    const audits = await queryRows<{
      action: string;
      actorUserId: string | null;
      details: { restoreId?: string; targetType?: string };
    }>(
      `SELECT "action", "actorUserId", "details" FROM "audit_event"
       WHERE "organizationId" = $1 AND "action" IN ('backup.restore_requested', 'backup.restored')
       ORDER BY "id"`,
      [fixture.owner.organizationId],
    );
    const requested = audits.find((audit) => audit.action === "backup.restore_requested");
    expect(requested).toMatchObject({ actorUserId: fixture.owner.userId });
    expect(requested?.details).toMatchObject({ restoreId: created.id, targetType: "database" });

    const restored = audits.find(
      (audit) => audit.action === "backup.restored" && audit.details.restoreId === created.id,
    );
    expect(restored).toMatchObject({ actorUserId: fixture.owner.userId });
  });

  it("restores a Volume, stopping only the Service that owns it", async () => {
    const backup = await createCompletedBackup("volume", fixture.volumeName, "volume-archive");
    agent.reset();

    const response = await restoreRequest(fixture.owner.cookie, backup.id, {
      confirmation: backup.targetName,
    });
    expect(response.status).toBe(202);
    const created = ((await response.json()) as { data: RestoreSummary }).data;
    expect(created).toMatchObject({
      targetType: "volume",
      targetName: "Restore App Volume",
      status: "pending",
    });

    const result = await restores.runRestoreJob({ id: "test-job", payload: { restoreId: created.id } });
    expect(result.status).toBe("completed");

    const owner = fixture.services[0];
    const other = fixture.services[1];
    expect(
      agent.requests
        .filter((entry) => entry.path.endsWith("/stop"))
        .map((entry) => entry.path),
    ).toEqual([`/v1/services/${owner.id}/stop`]);
    expect(
      agent.requests
        .filter((entry) => entry.path.endsWith("/start"))
        .map((entry) => entry.path),
    ).toEqual([`/v1/services/${owner.id}/start`]);

    const sent = agent.requests.filter((entry) => entry.path.startsWith("/v1/restores/"));
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toBe("volume-archive");
    const query = new URLSearchParams(sent[0].search);
    expect(query.get("targetType")).toBe("volume");
    expect(query.get("targetId")).toBe(fixture.volumeName);

    expect((await serviceStatuses())[other.id]).toBe("running");
    expect((await latestRestoreRow(created.id)).status).toBe("completed");
  });

  it("records a failed Restore, starts the Services again, and keeps the data", async () => {
    const backup = await createCompletedBackup("database", fixture.databaseId, "corrupt-dump");
    agent.reset();
    agent.failRestores = true;

    const response = await restoreRequest(fixture.owner.cookie, backup.id, {
      confirmation: backup.targetName,
    });
    expect(response.status).toBe(202);
    const created = ((await response.json()) as { data: RestoreSummary }).data;

    const result = await restores.runRestoreJob({ id: "test-job", payload: { restoreId: created.id } });
    expect(result.status).toBe("failed");

    const row = await latestRestoreRow(created.id);
    expect(row.status).toBe("failed");
    expect(row.errorMessage).toContain("500");
    expect(row.finishedAt).not.toBeNull();

    // The Services were stopped for the attempt and started again afterwards.
    expect(await serviceStatuses()).toMatchObject(
      Object.fromEntries(fixture.services.map((service) => [service.id, "running"])),
    );

    // The Backup itself is untouched, so the operator can retry or download it.
    const backups = await queryRows<{ status: string; storageKey: string | null }>(
      'SELECT "status", "storageKey" FROM "backup" WHERE "id" = $1',
      [backup.id],
    );
    expect(backups[0]).toMatchObject({ status: "completed" });

    const audits = await queryRows<{
      action: string;
      actorUserId: string | null;
      details: { restoreId?: string; error?: string };
    }>(
      `SELECT "action", "actorUserId", "details" FROM "audit_event"
       WHERE "organizationId" = $1 AND "action" IN ('backup.restored', 'backup.restore_failed')
       ORDER BY "id"`,
      [fixture.owner.organizationId],
    );
    expect(
      audits.some(
        (audit) =>
          audit.action === "backup.restored" && audit.details.restoreId === created.id,
      ),
    ).toBe(false);

    const failed = audits.find(
      (audit) => audit.action === "backup.restore_failed" && audit.details.restoreId === created.id,
    );
    expect(failed).toMatchObject({ actorUserId: fixture.owner.userId });
    expect(failed?.details.error).toContain("500");
  });

  it("requires the typed confirmation to match the target name", async () => {
    const backup = await createCompletedBackup("database", fixture.databaseId, "database-dump");

    const response = await restoreRequest(fixture.owner.cookie, backup.id, {
      confirmation: "yes",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string; details?: { expected?: string } };
    };
    expect(body.error.code).toBe("confirmation_mismatch");
    expect(body.error.details?.expected).toBe("PostgreSQL Database");

    const rows = await queryRows('SELECT 1 FROM "restore" WHERE "backupId" = $1', [backup.id]);
    expect(rows).toHaveLength(0);
  });

  it("refuses a Backup that is not completed yet", async () => {
    const rows = await queryRows<{ id: string }>(
      `INSERT INTO "backup" ("id", "organizationId", "projectId", "targetType", "targetId",
         "status", "expiresAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'database', $3, 'running',
         now() + interval '7 days')
       RETURNING "id"`,
      [fixture.owner.organizationId, fixture.projectId, fixture.databaseId],
    );

    const response = await restoreRequest(fixture.owner.cookie, rows[0].id, {
      confirmation: "PostgreSQL Database",
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "backup_not_completed",
    );
  });

  it("rejects a member and does not leak another Organization's Backups", async () => {
    const member = await addMember(fixture.owner.cookie, fixture.owner.organizationId, "member");
    const backup = await createCompletedBackup("database", fixture.databaseId, "database-dump");

    const forbidden = await restoreRequest(member.cookie, backup.id, {
      confirmation: backup.targetName,
    });
    expect(forbidden.status).toBe(403);

    // A member may still read the Restore history.
    const { GET } = await import("@/app/api/restores/route");
    const listResponse = await GET(
      new Request(`${BASE_URL}/api/restores`, {
        headers: { cookie: member.cookie, origin: BASE_URL },
      }),
    );
    expect(listResponse.status).toBe(200);
    const list = ((await listResponse.json()) as { data: RestoreList }).data;
    expect(Array.isArray(list.restores)).toBe(true);

    const other = await signUp(uniqueName("restoreother") + "@example.test", uniqueName("restoreother"));
    const otherResponse = await restoreRequest(other.cookie, backup.id, {
      confirmation: backup.targetName,
    });
    expect(otherResponse.status).toBe(404);
  });

  it("refuses a second Restore of a target that is already in flight", async () => {
    const backup = await createCompletedBackup("database", fixture.databaseId, "database-dump");

    const first = await restoreRequest(fixture.owner.cookie, backup.id, {
      confirmation: backup.targetName,
    });
    expect(first.status).toBe(202);
    const created = ((await first.json()) as { data: RestoreSummary }).data;

    const second = await restoreRequest(fixture.owner.cookie, backup.id, {
      confirmation: backup.targetName,
    });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe(
      "restore_in_progress",
    );

    // Clean up so the active-target index does not block later runs.
    await queryRows(
      'UPDATE "restore" SET "status" = \'failed\', "finishedAt" = now() WHERE "id" = $1',
      [created.id],
    );
  });

  it("fails Restores a previous worker left in flight", async () => {
    const backup = await createCompletedBackup("database", fixture.databaseId, "database-dump");
    const response = await restoreRequest(fixture.owner.cookie, backup.id, {
      confirmation: backup.targetName,
    });
    expect(response.status).toBe(202);
    const created = ((await response.json()) as { data: RestoreSummary }).data;

    const recovered = await restores.recoverStaleRestores();
    expect(recovered.failed).toBeGreaterThanOrEqual(1);

    const row = await latestRestoreRow(created.id);
    expect(row.status).toBe("failed");
    expect(row.errorMessage).toContain("worker restarted");
  });
});
