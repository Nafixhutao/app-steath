import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDatabase } from "../helpers/database";
import { Pool } from "pg";
import { createServer, type Server } from "node:http";

let pool: Pool;
let abuse: typeof import("@/lib/platform/abuse");
const ip = `test-${Math.random().toString(36).slice(2)}`;
const BASE_URL = "http://localhost:3000";
let adminCookie = "";
let adminId = "";
let fakeAgent: Server;
const agentRequests: string[] = [];
let authModule: typeof import("@/lib/auth");
const createdReportIds: string[] = [];
const createdOrganizationIds: string[] = [];
const createdUserIds: string[] = [];

beforeAll(async () => {
  await prepareTestDatabase();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  abuse = await import("@/lib/platform/abuse");
  process.env.BETTER_AUTH_URL = BASE_URL;
  process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
  process.env.AGENT_TOKEN = "test-agent-token";
  process.env.AGENT_NAME = "test-node";
  fakeAgent = createServer((request, response) => {
    agentRequests.push(`${request.method} ${request.url}`);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ serviceId: "suspended-service", status: "stopped" }));
  });
  await new Promise<void>((resolve) => fakeAgent.listen(0, "127.0.0.1", resolve));
  const address = fakeAgent.address();
  if (address && typeof address !== "string")
    process.env.AGENT_BASE_URL = `http://127.0.0.1:${address.port}`;
  authModule = await import("@/lib/auth");
  const signUp = async (email: string, username: string) => {
    const response = await authModule.auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL },
        body: JSON.stringify({ email, password: "password-12345", name: username, username }),
      }),
    );
    const user = (await response.json()) as { user: { id: string } };
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    return { userId: user.user.id, cookie };
  };
  const suffix = ip.replace(/[^a-z0-9]/gi, "");
  const admin = await signUp(`abuseadmin${suffix}@example.test`, `abuseadmin${suffix}`);
  adminId = admin.userId;
  createdUserIds.push(admin.userId);
  adminCookie = admin.cookie;
  process.env.PLATFORM_ADMIN_EMAILS = `abuseadmin${suffix}@example.test`;
});

afterAll(async () => {
  if (pool) {
    const { createHash } = await import("node:crypto");
    const ipHashes = [ip, `${ip}-limit`, `${ip}-public-api`, `${ip}-triage`, `${ip}-bad`].map(
      (value) => createHash("sha256").update(value).digest("hex"),
    );

    if (createdReportIds.length) {
      await pool.query('DELETE FROM "abuse_report" WHERE "id" = ANY($1::text[])', [
        createdReportIds,
      ]);
    }
    await pool.query('DELETE FROM "abuse_report_rate_limit" WHERE "ipHash" = ANY($1::text[])', [
      ipHashes,
    ]);

    // Both member foreign keys are ON DELETE NO ACTION, the last-owner guard is
    // a BEFORE DELETE trigger, and audit_event.actorUserId is ON DELETE
    // RESTRICT. Run the whole FK-sensitive cleanup on one connection inside a
    // single transaction so the transaction-local allow_owner_removal setting
    // applies to every deletion.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('platform.allow_owner_removal', 'true', true)");
      const actors = createdUserIds.length ? createdUserIds : [adminId];
      await client.query('DELETE FROM "audit_event" WHERE "actorUserId" = ANY($1::text[])', [
        actors,
      ]);

      // Better Auth creates a personal Organization for every sign-up. Collect
      // those IDs from the memberships before removing them.
      const memberOrganizations = await client.query<{ organizationId: string }>(
        'SELECT DISTINCT "organizationId" FROM "member" WHERE "userId" = ANY($1::text[])',
        [createdUserIds],
      );
      const organizationIds = [
        ...new Set([
          ...createdOrganizationIds,
          ...memberOrganizations.rows.map((row) => row.organizationId),
        ]),
      ];

      if (createdOrganizationIds.length) {
        await client.query(
          'DELETE FROM "service" WHERE "projectId" IN (SELECT "id" FROM "project" WHERE "organizationId" = ANY($1::text[]))',
          [createdOrganizationIds],
        );
        await client.query('DELETE FROM "project" WHERE "organizationId" = ANY($1::text[])', [
          createdOrganizationIds,
        ]);
      }
      if (createdUserIds.length) {
        await client.query('DELETE FROM "invitation" WHERE "inviterId" = ANY($1::text[])', [
          createdUserIds,
        ]);
        await client.query('DELETE FROM "member" WHERE "userId" = ANY($1::text[])', [
          createdUserIds,
        ]);
      }
      if (organizationIds.length) {
        await client.query('DELETE FROM "invitation" WHERE "organizationId" = ANY($1::text[])', [
          organizationIds,
        ]);
        await client.query('DELETE FROM "organization" WHERE "id" = ANY($1::text[])', [
          organizationIds,
        ]);
      }
      if (createdUserIds.length) {
        await client.query('DELETE FROM "user" WHERE "id" = ANY($1::text[])', [createdUserIds]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await pool.end();
  }
  if (fakeAgent) await new Promise<void>((resolve) => fakeAgent.close(() => resolve()));
});

describe("public Abuse Reports", () => {
  it("validates the challenge and creates a report with optional reporter email", async () => {
    await expect(
      abuse.createAbuseReport({
        targetUrl: "https://example.test/path",
        category: "phishing",
        description: "Impersonates a bank",
        reporterEmail: "reporter@example.test",
        challengeAnswer: "0",
        ip,
      }),
    ).rejects.toMatchObject({ code: "challenge_failed" });
    const created = await abuse.createAbuseReport({
      targetUrl: "https://example.test/path",
      category: "phishing",
      description: "Impersonates a bank",
      reporterEmail: "reporter@example.test",
      challengeAnswer: "7",
      ip,
    });
    createdReportIds.push(created.id);
    expect(created.status).toBe("new");
    const listed = await abuse.listAbuseReports("new");
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.id,
          category: "phishing",
          reporterEmail: "reporter@example.test",
        }),
      ]),
    );
  });

  it("serves the public report API without a session", async () => {
    const { POST } = await import("@/app/api/abuse-reports/route");
    const response = await POST(
      new Request(`${BASE_URL}/api/abuse-reports`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": `${ip}-public-api` },
        body: JSON.stringify({
          targetUrl: "https://public.example.test",
          category: "malware",
          description: "Test report",
          challengeAnswer: "7",
        }),
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { id: string } };
    createdReportIds.push(body.data.id);
  });

  it("limits an IP to three reports in a rolling hour window", async () => {
    const limitIp = `${ip}-limit`;
    const input = {
      targetUrl: "https://example.test",
      category: "spam",
      description: "Repeated unwanted content",
      challengeAnswer: "7",
      ip: limitIp,
    };
    const limitedReports = await Promise.all([1, 2, 3].map(() => abuse.createAbuseReport(input)));
    createdReportIds.push(...limitedReports.map((report) => report.id));
    await expect(abuse.createAbuseReport(input)).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
    const hash = (await import("node:crypto")).createHash("sha256").update(limitIp).digest("hex");
    await pool.query('DELETE FROM "abuse_report_rate_limit" WHERE "ipHash"=$1', [hash]);
  });

  it("rejects invalid URLs and categories", async () => {
    const input = {
      targetUrl: "file:///etc/passwd",
      category: "other",
      description: "A report",
      challengeAnswer: "7",
      ip: `${ip}-bad`,
    };
    await expect(abuse.createAbuseReport(input)).rejects.toMatchObject({
      code: "invalid_target_url",
    });
    await expect(
      abuse.createAbuseReport({ ...input, targetUrl: "https://example.test", category: "invalid" }),
    ).rejects.toMatchObject({ code: "invalid_report" });
  });

  it("isolates the admin queue and records triage as a global AuditEvent", async () => {
    const { GET } = await import("@/app/api/admin/abuse-reports/route");
    const outsider = await authModule.auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL },
        body: JSON.stringify({
          email: `abuseoutsider${ip.replace(/[^a-z0-9]/gi, "")}@example.test`,
          password: "password-12345",
          name: `abuseoutsider${ip.replace(/[^a-z0-9]/gi, "")}`,
          username: `abuseoutsider${ip.replace(/[^a-z0-9]/gi, "")}`,
        }),
      }),
    );
    const outsiderBody = (await outsider.clone().json()) as { user: { id: string } };
    createdUserIds.push(outsiderBody.user.id);
    const denied = await GET(
      new Request(`${BASE_URL}/api/admin/abuse-reports`, {
        headers: {
          cookie: outsider.headers
            .getSetCookie()
            .map((value) => value.split(";")[0])
            .join("; "),
        },
      }),
    );
    expect(denied.status).toBe(403);
    const response = await GET(
      new Request(`${BASE_URL}/api/admin/abuse-reports`, { headers: { cookie: adminCookie } }),
    );
    expect(response.status).toBe(200);
    const report = await abuse.createAbuseReport({
      targetUrl: "https://triage.example.test",
      category: "other",
      description: "Please review",
      challengeAnswer: "7",
      ip: `${ip}-triage`,
    });
    createdReportIds.push(report.id);
    const { PATCH } = await import("@/app/api/admin/abuse-reports/[reportId]/route");
    const updated = await PATCH(
      new Request(`${BASE_URL}/api/admin/abuse-reports/${report.id}`, {
        method: "PATCH",
        headers: { cookie: adminCookie, "content-type": "application/json" },
        body: JSON.stringify({ status: "triaged" }),
      }),
      { params: Promise.resolve({ reportId: report.id }) },
    );
    expect(updated.status).toBe(200);
    const audit = await pool.query(
      'SELECT "organizationId","actorUserId","action","details" FROM "audit_event" WHERE "actorUserId"=$1 AND "action"=$2 ORDER BY "createdAt" DESC LIMIT 1',
      [adminId, "platform.abuse_report.updated"],
    );
    expect(audit.rows[0]).toMatchObject({
      organizationId: null,
      actorUserId: adminId,
      details: { reportId: report.id, status: "triaged" },
    });
  });

  it("restricts cross-tenant resource search to Platform Admins", async () => {
    const { GET } = await import("@/app/api/admin/resources/route");
    const outsider = await authModule.auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL },
        body: JSON.stringify({
          email: `searchoutsider${ip.replace(/[^a-z0-9]/gi, "")}@example.test`,
          password: "password-12345",
          name: `searchoutsider${ip.replace(/[^a-z0-9]/gi, "")}`,
          username: `searchoutsider${ip.replace(/[^a-z0-9]/gi, "")}`,
        }),
      }),
    );
    const outsiderBody = (await outsider.clone().json()) as { user: { id: string } };
    createdUserIds.push(outsiderBody.user.id);
    const outsiderCookie = outsider.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const denied = await GET(
      new Request(`${BASE_URL}/api/admin/resources?q=tenant`, {
        headers: { cookie: outsiderCookie },
      }),
    );
    expect(denied.status).toBe(403);
    const allowed = await GET(
      new Request(`${BASE_URL}/api/admin/resources?q=tenant`, { headers: { cookie: adminCookie } }),
    );
    expect(allowed.status).toBe(200);
  });

  it("records both service and organization admin actions without tenant secrets", async () => {
    const id = `audit-susp-${Math.random().toString(36).slice(2, 10)}`;
    createdOrganizationIds.push(id);
    await pool.query(
      'INSERT INTO "organization" ("id","name","slug","createdAt") VALUES ($1,$2,$3,now())',
      [id, `Audit ${id}`, id],
    );
    await pool.query(
      'INSERT INTO "project" ("id","organizationId","name","slug") VALUES ($1,$2,$3,$4)',
      [`p-${id}`, id, `Project ${id}`, `p-${id}`],
    );
    await pool.query(
      `INSERT INTO "service" ("id","projectId","name","slug","repoUrl","platformHostname","status") VALUES ($1,$2,'Running','running','https://github.com/example/app','audit.example.test','running')`,
      [`s-${id}`, `p-${id}`],
    );
    const { POST: serviceSuspension } =
      await import("@/app/api/admin/suspensions/services/[serviceId]/route");
    const { POST: organizationSuspension } =
      await import("@/app/api/admin/suspensions/organizations/[organizationId]/route");
    const serviceResponse = await serviceSuspension(
      new Request(`${BASE_URL}/api/admin/suspensions/services/s-${id}`, {
        method: "POST",
        headers: { cookie: adminCookie, "content-type": "application/json" },
        body: JSON.stringify({ action: "suspend" }),
      }),
      { params: Promise.resolve({ serviceId: `s-${id}` }) },
    );
    expect(serviceResponse.status).toBe(200);
    const orgResponse = await organizationSuspension(
      new Request(`${BASE_URL}/api/admin/suspensions/organizations/${id}`, {
        method: "POST",
        headers: { cookie: adminCookie, "content-type": "application/json" },
        body: JSON.stringify({ action: "suspend" }),
      }),
      { params: Promise.resolve({ organizationId: id }) },
    );
    expect(orgResponse.status).toBe(200);
    const audit = await pool.query(
      'SELECT "organizationId","action","details" FROM "audit_event" WHERE "actorUserId"=$1 AND ("details"->>\'organizationId\'=$2 OR "details"->>\'serviceId\'=$3) ORDER BY "createdAt"',
      [adminId, id, `s-${id}`],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(["platform.service.suspended", "platform.organization.suspended"]),
    );
    expect(JSON.stringify(audit.rows)).not.toMatch(/secret|password/i);
    await pool.query('DELETE FROM "service" WHERE "id"=$1', [`s-${id}`]);
    await pool.query('DELETE FROM "project" WHERE "id"=$1', [`p-${id}`]);
    await pool.query('DELETE FROM "organization" WHERE "id"=$1', [id]);
  });

  it("suspends a Service and only restarts it if it was running", async () => {
    const id = `susp-${Math.random().toString(36).slice(2, 10)}`;
    createdOrganizationIds.push(id);
    await pool.query(
      'INSERT INTO "organization" ("id","name","slug","createdAt") VALUES ($1,$2,$3,now())',
      [id, `Suspension ${id}`, id],
    );
    await pool.query(
      'INSERT INTO "project" ("id","organizationId","name","slug") VALUES ($1,$2,$3,$4)',
      [`p-${id}`, id, `Project ${id}`, `p-${id}`],
    );
    await pool.query(
      `INSERT INTO "service" ("id","projectId","name","slug","repoUrl","platformHostname","status") VALUES ($1,$2,'Stopped','stopped','https://github.com/example/app','stopped.example.test','stopped'),($3,$2,'Running','running','https://github.com/example/app','running.example.test','running')`,
      [`s-${id}`, `p-${id}`, `r-${id}`],
    );
    const { suspendService, unsuspendService, suspendOrganization, unsuspendOrganization } =
      await import("@/lib/platform/suspensions");
    await suspendService(`s-${id}`);
    await unsuspendService(`s-${id}`);
    const stopped = await pool.query(
      'SELECT "status","suspendedFromStatus" FROM "service" WHERE "id"=$1',
      [`s-${id}`],
    );
    expect(stopped.rows[0]).toEqual({ status: "stopped", suspendedFromStatus: null });
    expect(agentRequests.some((line) => line.endsWith("/start"))).toBe(false);
    await suspendOrganization(id);
    const orgSuspended = await pool.query(
      'SELECT "suspendedAt" FROM "organization" WHERE "id"=$1',
      [id],
    );
    expect(orgSuspended.rows[0].suspendedAt).not.toBeNull();
    await unsuspendOrganization(id);
    const restored = await pool.query(
      'SELECT "id","status","suspendedFromStatus" FROM "service" WHERE "projectId"=$1 ORDER BY "id"',
      [`p-${id}`],
    );
    expect(restored.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: `s-${id}`, status: "stopped", suspendedFromStatus: null }),
        expect.objectContaining({ id: `r-${id}`, status: "running", suspendedFromStatus: null }),
      ]),
    );
    expect(
      agentRequests.filter((line) => line.includes("/unsuspend")).length,
    ).toBeGreaterThanOrEqual(3);
    await pool.query('DELETE FROM "service" WHERE "projectId"=$1', [`p-${id}`]);
    await pool.query('DELETE FROM "project" WHERE "id"=$1', [`p-${id}`]);
    await pool.query('DELETE FROM "organization" WHERE "id"=$1', [id]);
  });
});
