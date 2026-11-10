import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
type BackupsModule = typeof import("@/lib/platform/backups");
type BackupList = import("@/lib/platform/backups").BackupList;

let auth: Auth;
let backups: BackupsModule;

/**
 * A fake Node Agent that produces and serves Backup artifacts. It answers the
 * Database provisioning call so a Database can be created, and records every
 * Backup request so the tests can assert what the Control Plane asked for.
 */
type FakeAgent = {
  server: Server;
  baseUrl: string;
  requests: Array<{ method: string; path: string; body?: unknown }>;
  failBackups: boolean;
  reset(): void;
};

async function startFakeAgent(): Promise<FakeAgent> {
  const agent: FakeAgent = {
    server: createServer(() => undefined),
    baseUrl: "",
    requests: [],
    failBackups: false,
    reset() {
      agent.requests = [];
      agent.failBackups = false;
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

  if (request.method === "POST" && url.pathname === "/v1/backups") {
    if (agent.failBackups) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "backup_failed" }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ backupId: body?.backupId, sizeBytes: Buffer.byteLength("backup-data") }),
    );
    return;
  }

  const contentMatch = /^\/v1\/backups\/([^/]+)\/content$/.exec(url.pathname);
  if (contentMatch && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.end("backup-data");
    return;
  }

  const removeMatch = /^\/v1\/backups\/([^/]+)$/.exec(url.pathname);
  if (removeMatch && request.method === "DELETE") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ backupId: decodeURIComponent(removeMatch[1]), removed: true }));
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

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not found" }));
}

/**
 * A minimal S3-compatible endpoint. It records each signed request so the tests
 * can assert the server-side encryption header and the SigV4 authorization.
 */
type S3Request = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

type FakeS3 = {
  server: Server;
  endpoint: string;
  requests: S3Request[];
  fail: boolean;
  reset(): void;
};

async function startFakeS3(): Promise<FakeS3> {
  const s3: FakeS3 = {
    server: createServer(() => undefined),
    endpoint: "",
    requests: [],
    fail: false,
    reset() {
      s3.requests = [];
      s3.fail = false;
    },
  };

  s3.server = createServer((request, response) => {
    void (async () => {
      const raw = await readBody(request);
      s3.requests.push({
        method: request.method ?? "GET",
        path: new URL(request.url ?? "/", "http://s3.test").pathname,
        headers: request.headers,
        body: raw,
      });

      if (s3.fail) {
        response.writeHead(500, { "content-type": "application/xml" });
        response.end("<Error><Code>InternalError</Code></Error>");
        return;
      }

      response.writeHead(200);
      response.end();
    })();
  });

  await new Promise<void>((resolve) => {
    s3.server.listen(0, "127.0.0.1", resolve);
  });

  const address = s3.server.address() as AddressInfo;
  s3.endpoint = `http://127.0.0.1:${address.port}`;

  return s3;
}

let agent: FakeAgent;
let s3: FakeS3;

function useS3(): void {
  process.env.S3_ENDPOINT = s3.endpoint;
  process.env.S3_BUCKET = "test-bucket";
  process.env.S3_REGION = "us-east-1";
  process.env.S3_ACCESS_KEY_ID = "test-key";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret";
}

function useLocal(dir: string): void {
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_BUCKET;
  delete process.env.S3_REGION;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
  process.env.BACKUP_LOCAL_DIR = dir;
}

beforeAll(async () => {
  process.env.ENV_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  await prepareTestDatabase();
  process.env.BETTER_AUTH_URL = BASE_URL;
  process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
  process.env.AGENT_TOKEN = AGENT_TOKEN;

  agent = await startFakeAgent();
  s3 = await startFakeS3();

  process.env.AGENT_BASE_URL = agent.baseUrl;
  process.env.AGENT_NAME = "test-node";

  ({ auth } = await import("@/lib/auth"));
  backups = await import("@/lib/platform/backups");

  // The scheduling pass covers every Database and Volume in the database, so a
  // previous run's Backups must not make today look already scheduled.
  await queryRows('DELETE FROM "job" WHERE "type" = $1', [backups.BACKUP_JOB_TYPE]);
  await queryRows('DELETE FROM "backup"', []);

  fixture = await createFixture();
});

afterAll(async () => {
  if (agent) {
    await new Promise<void>((resolve) => agent.server.close(() => resolve()));
  }
  if (s3) {
    await new Promise<void>((resolve) => s3.server.close(() => resolve()));
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
  const email = uniqueName(`backup${role}`) + Math.random().toString(36).slice(2, 6) + "@example.test";
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
  serviceId: string;
  databaseId: string;
  volumeName: string;
};

let fixture: Fixture;

async function createFixture(): Promise<Fixture> {
  const owner = await signUp(uniqueName("backupowner") + "@example.test", uniqueName("backupowner"));

  const { POST: createProject } = await import("@/app/api/projects/route");
  const projectResponse = await createProject(
    new Request(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { cookie: owner.cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ name: "Backup Project" }),
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
        name: "Backup App",
        repoUrl: "https://github.com/example/web-app",
        branch: "main",
      }),
    }),
    { params: Promise.resolve({ projectId: project.id }) },
  );
  expect(serviceResponse.status).toBe(201);
  const service = ((await serviceResponse.json()) as { data: { id: string } }).data;

  const { POST: createVolume } = await import("@/app/api/services/[serviceId]/volume/route");
  const volumeResponse = await createVolume(
    new Request(`${BASE_URL}/api/services/${service.id}/volume`, {
      method: "POST",
      headers: { cookie: owner.cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ mountPath: "/data" }),
    }),
    { params: Promise.resolve({ serviceId: service.id }) },
  );
  expect(volumeResponse.status).toBe(201);

  const { POST: createDatabase } = await import("@/app/api/projects/[projectId]/database/route");
  const databaseResponse = await createDatabase(
    new Request(`${BASE_URL}/api/projects/${project.id}/database`, {
      method: "POST",
      headers: { cookie: owner.cookie, origin: BASE_URL, "content-type": "application/json" },
    }),
    { params: Promise.resolve({ projectId: project.id }) },
  );
  expect(databaseResponse.status).toBe(201);
  const database = ((await databaseResponse.json()) as { data: { id: string } }).data;

  return {
    owner,
    projectId: project.id,
    serviceId: service.id,
    databaseId: database.id,
    volumeName: `stealth-vol-${service.id}`,
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

async function createBackupRow(input: {
  organizationId: string | null;
  projectId: string | null;
  targetType: "database" | "volume" | "platform";
  targetId: string | null;
  status?: string;
  storageKey?: string | null;
  storageProvider?: "s3" | "local" | null;
  expiresAt?: Date;
}): Promise<string> {
  const rows = await queryRows<{ id: string }>(
    `INSERT INTO "backup" ("id", "organizationId", "projectId", "targetType", "targetId",
       "status", "storageKey", "storageProvider", "expiresAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING "id"`,
    [
      input.organizationId,
      input.projectId,
      input.targetType,
      input.targetId,
      input.status ?? "pending",
      input.storageKey ?? null,
      input.storageProvider ?? null,
      input.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
    ],
  );

  return rows[0].id;
}

async function latestBackupId(
  targetType: "database" | "volume" | "platform",
  targetId: string | null,
): Promise<string> {
  const rows = await queryRows<{ id: string }>(
    `SELECT "id" FROM "backup"
     WHERE "targetType" = $1 AND "targetId" IS NOT DISTINCT FROM $2
     ORDER BY "createdAt" DESC LIMIT 1`,
    [targetType, targetId],
  );
  expect(rows).toHaveLength(1);

  return rows[0].id;
}

describe("Daily Backups", () => {
  it("schedules one Backup per Database, Volume, and the platform, once a day", async () => {
    const now = new Date();
    const scheduledAt = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2, 30),
    );

    const first = await backups.scheduleDailyBackups(scheduledAt);
    expect(first.skipped).toBe(false);
    expect(first.scheduled).toBeGreaterThanOrEqual(3);

    const rows = await queryRows<{ targetType: string; organizationId: string | null }>(
      'SELECT "targetType", "organizationId" FROM "backup"',
      [],
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { targetType: "database", organizationId: fixture.owner.organizationId },
        { targetType: "volume", organizationId: fixture.owner.organizationId },
        { targetType: "platform", organizationId: null },
      ]),
    );

    // Every scheduled Backup has one queued Job.
    const jobs = await queryRows<{ payload: { backupId: string } }>(
      'SELECT "payload" FROM "job" WHERE "type" = $1',
      [backups.BACKUP_JOB_TYPE],
    );
    expect(jobs).toHaveLength(first.scheduled);
    for (const job of jobs) {
      expect(typeof job.payload.backupId).toBe("string");
    }

    // A second pass on the same UTC day is a no-op.
    const second = await backups.scheduleDailyBackups(scheduledAt);
    expect(second).toEqual({ scheduled: 0, skipped: false });
  });

  it("uploads a Database Backup to S3 with server-side encryption and a signed request", async () => {
    useS3();
    s3.reset();
    agent.reset();

    const backupId = await latestBackupId("database", fixture.databaseId);
    const result = await backups.runBackupJob({ id: "test-job", payload: { backupId } });
    expect(result.status).toBe("completed");

    const rows = await queryRows<{
      status: string;
      storageProvider: string;
      storageKey: string;
      sizeBytes: string;
      errorMessage: string | null;
    }>(
      'SELECT "status", "storageProvider", "storageKey", "sizeBytes", "errorMessage" FROM "backup" WHERE "id" = $1',
      [backupId],
    );
    expect(rows[0]).toMatchObject({
      status: "completed",
      storageProvider: "s3",
      storageKey: `backups/${fixture.owner.organizationId}/${backupId}.dump`,
      sizeBytes: String(Buffer.byteLength("backup-data")),
      errorMessage: null,
    });

    // The artifact went to the bucket, encrypted, and SigV4-signed.
    expect(s3.requests).toHaveLength(1);
    const put = s3.requests[0];
    expect(put.method).toBe("PUT");
    expect(put.path).toBe(`/test-bucket/backups/${fixture.owner.organizationId}/${backupId}.dump`);
    expect(put.headers["x-amz-server-side-encryption"]).toBe("AES256");
    expect(String(put.headers.authorization)).toMatch(
      /^AWS4-HMAC-SHA256 Credential=test-key\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=/,
    );
    expect(put.body).toBe("backup-data");

    // The agent copy is staging only and is removed after the upload.
    expect(
      agent.requests.some(
        (entry) => entry.method === "DELETE" && entry.path === `/v1/backups/${backupId}`,
      ),
    ).toBe(true);
  });

  it("falls back to local storage when S3 credentials are absent", async () => {
    const localDir = await mkdtemp(path.join(tmpdir(), "backup-local-"));
    useLocal(localDir);
    agent.reset();

    const backupId = await latestBackupId("volume", fixture.volumeName);
    const result = await backups.runBackupJob({ id: "test-job", payload: { backupId } });
    expect(result.status).toBe("completed");

    const rows = await queryRows<{ status: string; storageProvider: string; storageKey: string }>(
      'SELECT "status", "storageProvider", "storageKey" FROM "backup" WHERE "id" = $1',
      [backupId],
    );
    expect(rows[0]).toMatchObject({
      status: "completed",
      storageProvider: "local",
      storageKey: `backups/${fixture.owner.organizationId}/${backupId}.tar.gz`,
    });

    const stored = await readFile(
      path.join(localDir, "backups", fixture.owner.organizationId, `${backupId}.tar.gz`),
      "utf8",
    );
    expect(stored).toBe("backup-data");

    // A Volume Backup asks the agent to archive the Docker Volume.
    const created = agent.requests.find(
      (entry) => entry.method === "POST" && entry.path === "/v1/backups",
    );
    expect(created?.body).toMatchObject({
      targetType: "volume",
      targetId: fixture.volumeName,
    });

    await rm(localDir, { recursive: true, force: true });
  });

  it("removes Backups and their stored objects after seven days", async () => {
    const localDir = await mkdtemp(path.join(tmpdir(), "backup-prune-"));
    useLocal(localDir);

    const storageKey = `backups/${fixture.owner.organizationId}/expired.dump`;
    const filePath = path.join(localDir, "backups", fixture.owner.organizationId, "expired.dump");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "expired-bytes");

    const backupId = await createBackupRow({
      organizationId: fixture.owner.organizationId,
      projectId: fixture.projectId,
      targetType: "database",
      targetId: fixture.databaseId,
      status: "completed",
      storageKey,
      storageProvider: "local",
      expiresAt: new Date(Date.now() - 60_000),
    });

    const result = await backups.pruneBackups(new Date());
    expect(result.removed).toBeGreaterThanOrEqual(1);

    const remaining = await queryRows('SELECT 1 FROM "backup" WHERE "id" = $1', [backupId]);
    expect(remaining).toHaveLength(0);
    await expect(readFile(filePath)).rejects.toThrow();

    await rm(localDir, { recursive: true, force: true });
  });

  it("records a failed Backup as an AuditEvent and shows the error", async () => {
    useS3();
    s3.reset();
    s3.fail = true;
    agent.reset();

    const backupId = await createBackupRow({
      organizationId: fixture.owner.organizationId,
      projectId: fixture.projectId,
      targetType: "database",
      targetId: fixture.databaseId,
    });

    const result = await backups.runBackupJob({ id: "test-job", payload: { backupId } });
    expect(result.status).toBe("failed");

    const rows = await queryRows<{ status: string; errorMessage: string | null }>(
      'SELECT "status", "errorMessage" FROM "backup" WHERE "id" = $1',
      [backupId],
    );
    expect(rows[0].status).toBe("failed");
    expect(rows[0].errorMessage).toContain("S3 PUT");

    const audits = await queryRows<{
      action: string;
      actorUserId: string | null;
      details: { backupId?: string; targetType?: string };
    }>(
      `SELECT "action", "actorUserId", "details" FROM "audit_event"
       WHERE "organizationId" = $1 AND "action" = $2
       ORDER BY "id" DESC LIMIT 1`,
      [fixture.owner.organizationId, "backup.failed"],
    );
    expect(audits[0]).toMatchObject({ action: "backup.failed", actorUserId: null });
    expect(audits[0].details).toMatchObject({
      backupId,
      targetType: "database",
    });

    s3.fail = false;
  });

  it("lets a member list Backups without leaking another Organization's rows", async () => {
    const localDir = await mkdtemp(path.join(tmpdir(), "backup-list-"));
    useLocal(localDir);

    const member = await addMember(fixture.owner.cookie, fixture.owner.organizationId, "member");

    const ownerBackupId = await latestBackupId("database", fixture.databaseId);
    const platformBackupId = await latestBackupId("platform", null);

    const other = await signUp(uniqueName("backupother") + "@example.test", uniqueName("backupother"));
    const otherBackupId = await createBackupRow({
      organizationId: other.organizationId,
      projectId: null,
      targetType: "database",
      targetId: "another-database",
    });

    const { GET } = await import("@/app/api/backups/route");
    const response = await GET(
      new Request(`${BASE_URL}/api/backups`, {
        headers: { cookie: member.cookie, origin: BASE_URL },
      }),
    );
    expect(response.status).toBe(200);

    const list = ((await response.json()) as { data: BackupList }).data;
    expect(list.storageProvider).toBe("local");

    const ids = list.backups.map((backup) => backup.id);
    expect(ids).toContain(ownerBackupId);
    expect(ids).toContain(platformBackupId);
    expect(ids).not.toContain(otherBackupId);

    // The list carries everything the dashboard shows: target, time, size, status.
    const sample = list.backups.find((backup) => backup.id === ownerBackupId);
    expect(sample).toMatchObject({
      targetType: "database",
      status: expect.any(String),
      sizeBytes: expect.any(Number),
    });
    expect(typeof sample?.targetName).toBe("string");
    expect(typeof sample?.createdAt).toBe("string");
    expect(typeof sample?.expiresAt).toBe("string");

    const platform = list.backups.find((backup) => backup.id === platformBackupId);
    expect(platform).toMatchObject({ targetType: "platform", projectName: null });

    await rm(localDir, { recursive: true, force: true });
  });
});
