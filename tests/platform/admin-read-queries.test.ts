import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { prepareTestDatabase } from "../helpers/database";

/**
 * The admin read/work projections against a real PostgreSQL. The routes were
 * the only coverage these queries had before; now the module is called
 * directly, seeded minimally, and asserted on its Forge wire shapes.
 */

let pool: Pool;

const RUN_ID = Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  await prepareTestDatabase();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // One user, so the account directory and the FK chain have something to
  // point at. better-auth's user table needs name/email/createdAt/updatedAt.
  await pool.query(
    `INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, now(), now())
     ON CONFLICT ("id") DO NOTHING`,
    [`user-${RUN_ID}`, `User ${RUN_ID}`, `user-${RUN_ID}@example.test`],
  );
  await pool.query(
    `INSERT INTO "organization" ("id", "name", "slug", "createdAt")
     VALUES ($1, $2, $3, now())
     ON CONFLICT ("slug") DO NOTHING`,
    [`org-${RUN_ID}`, `Org ${RUN_ID}`, `org-${RUN_ID}`],
  );
  await pool.query(
    `INSERT INTO "project" ("id", "organizationId", "name", "slug")
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ("id") DO NOTHING`,
    [`proj-${RUN_ID}`, `org-${RUN_ID}`, `proj-${RUN_ID}`, `proj-${RUN_ID}`],
  );
  await pool.query(
    `INSERT INTO "service" ("id", "projectId", "name", "slug", "repoUrl", "platformHostname")
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ("id") DO NOTHING`,
    [
      `svc-${RUN_ID}`,
      `proj-${RUN_ID}`,
      `svc-${RUN_ID}`,
      `svc-${RUN_ID}`,
      "https://github.com/example/repo",
      `svc-${RUN_ID}.example.test`,
    ],
  );
  // A failed deployment with startedAt/finishedAt: both the error-group
  // aggregation (min/max) and the operations list read these columns.
  await pool.query(
    `INSERT INTO "deployment" ("id", "serviceId", "status", "errorMessage",
                               "startedAt", "finishedAt")
     VALUES ($1, $2, 'failed', 'Build failed: exit 1', now(), now())
     ON CONFLICT ("id") DO NOTHING`,
    [`dep-${RUN_ID}`, `svc-${RUN_ID}`],
  );
  // One build log line on the real deployment; build_log is keyed by
  // (deploymentId, sequence) with no id column.
  await pool.query(
    `INSERT INTO "build_log" ("deploymentId", "sequence", "message")
     VALUES ($1, 1, 'ERROR: image build exploded')
     ON CONFLICT DO NOTHING`,
    [`dep-${RUN_ID}`],
  );
});

afterAll(async () => {
  if (pool) {
    // The scratch database is dropped with its container, so only the rows
    // other test files in this run could collide with get removed. The user
    // row stays: signup's personal-organization trigger owns an owner member
    // guarded against last-owner removal.
    await pool.query(`DELETE FROM "admin_incident" WHERE "title" LIKE $1`, [`%${RUN_ID}%`]);
    await pool.query(`DELETE FROM "deployment" WHERE "id" = $1`, [`dep-${RUN_ID}`]);
    await pool.query(`DELETE FROM "service" WHERE "id" = $1`, [`svc-${RUN_ID}`]);
    await pool.query(`DELETE FROM "project" WHERE "id" = $1`, [`proj-${RUN_ID}`]);
    await pool.query(`DELETE FROM "organization" WHERE "id" = $1`, [`org-${RUN_ID}`]);
    await pool.end();
  }
});

describe("getAdminOverview", () => {
  it("answers the Forge overview shape with component health and counts", async () => {
    const { getAdminOverview } = await import("@/lib/platform/admin-read-queries");

    const payload = await getAdminOverview();

    expect(payload.instance_status).toBeTypeOf("string");
    expect(new Date(payload.checked_at).toISOString()).toBe(payload.checked_at);
    expect(payload.components.map((c) => c.name)).toEqual(["api", "postgres", "redis", "agent"]);
    // Redis is honest-unavailable in the production stack.
    expect(payload.components.find((c) => c.name === "redis")?.status).toBe("unavailable");
    expect(payload.telemetry).toEqual({ status: "unavailable" });
    expect(payload.operations).toHaveProperty("queued_jobs");
    expect(Array.isArray(payload.recent_deployments)).toBe(true);
  });
});

describe("getAdminStatusPage", () => {
  it("answers the public status vocabulary and active incident titles", async () => {
    const { getAdminStatusPage } = await import("@/lib/platform/admin-read-queries");

    const payload = await getAdminStatusPage();

    expect(payload.name).toBe("Stealth PaaS");
    expect(payload.is_public).toBe(false);
    expect(payload.components.map((c) => c.name)).toEqual(["API", "Database", "Cache", "Agents"]);
    expect(Array.isArray(payload.published_incidents)).toBe(true);
  });
});

describe("getAdminDbMetrics and getAdminRedisMetrics", () => {
  it("answers reachable history from the retained samples", async () => {
    const { getAdminDbMetrics, getAdminRedisMetrics } =
      await import("@/lib/platform/admin-read-queries");

    const db = await getAdminDbMetrics(5);
    expect(Array.isArray(db.history)).toBe(true);
    expect(typeof db.server_version).toBe("string");
    // PostgreSQL is reachable in the test run, so version() answers.
    expect(db.reachable).toBe(true);

    // No REDIS_URL in the test run: the honest unavailable state.
    const redis = await getAdminRedisMetrics(5);
    expect(redis.reachable).toBe(false);
    expect(redis.history).toEqual([]);
    expect(redis.current).toBeNull();
  });

  it("clamps a window beyond the 24-hour retention cap", async () => {
    const { getAdminDbMetrics } = await import("@/lib/platform/admin-read-queries");

    // A huge window must not throw; the module clamps it internally.
    const payload = await getAdminDbMetrics(10_000);
    expect(Array.isArray(payload.history)).toBe(true);
  });
});

describe("listAdminAccounts", () => {
  it("lists accounts in the Forge wire shape with the honest Free plan", async () => {
    const { listAdminAccounts } = await import("@/lib/platform/admin-read-queries");

    const { items } = await listAdminAccounts();
    expect(items.length).toBeGreaterThan(0);

    const mine = items.find((item) => item.id === `user-${RUN_ID}`);
    expect(mine).toBeDefined();
    expect(mine?.plan).toBe("free");
    expect(mine?.email).toBe(`user-${RUN_ID}@example.test`);
    expect(mine?.email_verified).toBe(true);
    expect(new Date(mine!.created_at).toISOString()).toBe(mine!.created_at);
    expect(Array.isArray(mine!.providers)).toBe(true);
  });
});

describe("incident projections", () => {
  it("creates, lists with events, updates status, and reports a missing id", async () => {
    const work = await import("@/lib/platform/admin-work-queries");

    const created = await work.createIncident({
      title: `Test incident ${RUN_ID}`,
      severity: "warning",
      status: "investigating",
      services: ["svc-1"],
      message: "Opening note",
      createdByAccountId: `user-${RUN_ID}`,
    });
    expect(created.id).toBeTypeOf("string");

    const { items } = await work.listIncidents(100, "admin@example.test");
    const mine = items.find((item) => item.id === created.id);
    expect(mine).toBeDefined();
    expect(mine?.severity).toBe("warning");
    expect(mine?.admin_email).toBe("admin@example.test");
    expect(mine?.events).toHaveLength(1);
    expect(mine?.events[0].kind).toBe("note");
    expect(new Date(mine!.started_at).toISOString()).toBe(mine!.started_at);

    await work.updateIncidentStatus(created.id, "resolved");
    const after = (await work.listIncidents(100, "admin@example.test")).items.find(
      (item) => item.id === created.id,
    );
    expect(after?.status).toBe("resolved");
    expect(after?.resolved_at).toBeTypeOf("string");

    await expect(work.updateIncidentStatus("no-such-id", "resolved")).rejects.toThrow(
      "Incident not found.",
    );
  });
});

describe("listOperations", () => {
  it("answers a bounded list in the Forge operations shape", async () => {
    const { listOperations } = await import("@/lib/platform/admin-work-queries");

    const { items } = await listOperations({ windowMinutes: 60, limit: 50 });
    expect(Array.isArray(items)).toBe(true);

    for (const item of items) {
      expect(typeof item.duration_ms).toBe("number");
      expect(new Date(item.created_at).toISOString()).toBe(item.created_at);
    }
  });

  it("accepts an explicit from/to window like the Forge client sends", async () => {
    const { listOperations } = await import("@/lib/platform/admin-work-queries");

    const from = new Date(Date.now() - 60 * 60 * 1_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();

    const { items } = await listOperations({ from, to, windowMinutes: 0, limit: 10 });
    expect(Array.isArray(items)).toBe(true);
  });
});

describe("listErrorGroups", () => {
  it("folds failed deployments and jobs into fingerprinted groups", async () => {
    const { listErrorGroups } = await import("@/lib/platform/admin-work-queries");

    const { items } = await listErrorGroups({ windowHours: 24 });
    const group = items.find((item) => item.message === "Build failed: exit 1");
    expect(group).toBeDefined();
    expect(group?.service).toBe("build");
    expect(group?.status).toBe("open");
    expect(group?.occurrence_count).toBeGreaterThan(0);
    expect(group?.error_type).toBe("DeploymentError");
  });
});

describe("tailBuildLogs", () => {
  it("tails build_log with the derived level and the build service", async () => {
    const { tailBuildLogs } = await import("@/lib/platform/admin-work-queries");

    const { items } = await tailBuildLogs({ search: "exploded", limit: 10 });
    const line = items.find((item) => item.message === "ERROR: image build exploded");
    expect(line).toBeDefined();
    expect(line?.level).toBe("ERROR");
    expect(line?.service).toBe("build");
    expect(new Date(line!.timestamp).toISOString()).toBe(line!.timestamp);
  });
});
