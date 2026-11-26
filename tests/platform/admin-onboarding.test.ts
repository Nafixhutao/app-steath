import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { prepareTestDatabase } from "../helpers/database";

/**
 * The Admin Overview setup summary against a real PostgreSQL. The contract is
 * that every completed flag is derived from the table the matching admin task
 * writes, and that the Old instance (waiting for the email/OAuth migrations)
 * answers "not configured" instead of failing the page.
 */

let pool: Pool;
let onboarding: typeof import("@/lib/platform/admin-onboarding");

const RUN_ID = Math.random().toString(36).slice(2, 8);
const OAUTH_ENV_KEYS = [
  "GITHUB_CLIENT_ID",
  "BETTER_AUTH_GITHUB_CLIENT_ID",
  "GOOGLE_CLIENT_ID",
  "BETTER_AUTH_GOOGLE_CLIENT_ID",
] as const;
const savedEnv = new Map<string, string | undefined>(
  OAUTH_ENV_KEYS.map((key) => [key, process.env[key]]),
);

beforeAll(async () => {
  await prepareTestDatabase();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Neutral starting point: no open reports, no stored OAuth row, no enabled
  // email provider. The scratch database survives between runs, so every
  // assertion below compares against this reset state instead of luck.
  await pool.query('DELETE FROM "abuse_report"');
  await pool.query('DELETE FROM "oauth_provider_config"');
  await pool.query(
    `UPDATE "email_provider"
        SET "enabled" = false, "apiKeyEncrypted" = NULL, "apiSecretEncrypted" = NULL`,
  );
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.BETTER_AUTH_GITHUB_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.BETTER_AUTH_GOOGLE_CLIENT_ID;

  onboarding = await import("@/lib/platform/admin-onboarding");
});

afterAll(async () => {
  if (pool) {
    await pool.query('DELETE FROM "abuse_report" WHERE "id" LIKE $1', [`abuse-${RUN_ID}-%`]);
    await pool.query('DELETE FROM "oauth_provider_config"');
    await pool.query(
      `UPDATE "email_provider"
          SET "enabled" = false, "apiKeyEncrypted" = NULL, "apiSecretEncrypted" = NULL`,
    );
    await pool.query('DELETE FROM "service" WHERE "id" LIKE $1', [`svc-${RUN_ID}-%`]);
    await pool.query('DELETE FROM "project" WHERE "id" LIKE $1', [`proj-${RUN_ID}-%`]);
    await pool.query('DELETE FROM "organization" WHERE "id" LIKE $1', [`org-${RUN_ID}-%`]);
    await pool.end();
  }

  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("getAdminSetupSummary", () => {
  it("starts at one of three steps: the abuse queue is already clear", async () => {
    const summary = await onboarding.getAdminSetupSummary();

    expect(summary.total).toBe(3);
    expect(summary.steps.map((step) => step.id)).toEqual(["abuse", "email", "oauth"]);
    expect(summary.steps.find((step) => step.id === "abuse")?.completed).toBe(true);
    expect(summary.steps.find((step) => step.id === "email")?.completed).toBe(false);
    expect(summary.steps.find((step) => step.id === "oauth")?.completed).toBe(false);
    expect(summary.completed).toBe(1);
    expect(summary.pendingAbuseReports).toBe(0);
  });

  it("counts Organizations and Services for the stat row", async () => {
    const before = await onboarding.getAdminSetupSummary();

    await pool.query(
      `INSERT INTO "organization" ("id", "name", "slug", "createdAt")
       VALUES ($1, $2, $3, now())`,
      [`org-${RUN_ID}-count`, `Org ${RUN_ID}`, `org-${RUN_ID}-count`],
    );
    await pool.query(
      `INSERT INTO "project" ("id", "organizationId", "name", "slug")
       VALUES ($1, $2, $3, $4)`,
      [`proj-${RUN_ID}-count`, `org-${RUN_ID}-count`, `proj-${RUN_ID}`, `proj-${RUN_ID}-count`],
    );
    await pool.query(
      `INSERT INTO "service" ("id", "projectId", "name", "slug", "repoUrl", "platformHostname")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        `svc-${RUN_ID}-count`,
        `proj-${RUN_ID}-count`,
        `svc-${RUN_ID}`,
        `svc-${RUN_ID}`,
        "https://github.com/example/repo",
        `svc-${RUN_ID}-count.example.test`,
      ],
    );

    const after = await onboarding.getAdminSetupSummary();
    expect(after.organizations).toBe(before.organizations + 1);
    expect(after.services).toBe(before.services + 1);
  });

  it("requires an enabled provider with a stored credential for the email step", async () => {
    await pool.query(
      `UPDATE "email_provider"
          SET "enabled" = true, "apiKeyEncrypted" = NULL
        WHERE "provider" = 'resend'`,
    );
    expect((await onboarding.getAdminSetupSummary()).steps[1].completed).toBe(false);

    await pool.query(
      `UPDATE "email_provider"
          SET "apiKeyEncrypted" = 'sealed-test-key'
        WHERE "provider" = 'resend'`,
    );
    expect((await onboarding.getAdminSetupSummary()).steps[1].completed).toBe(true);
    expect((await onboarding.getAdminSetupSummary()).completed).toBe(2);
  });

  it("accepts a stored OAuth row or environment credentials", async () => {
    await pool.query(
      `INSERT INTO "oauth_provider_config" ("provider", "clientId", "clientSecret")
       VALUES ('github', 'client-id', 'sealed-secret')`,
    );
    expect((await onboarding.getAdminSetupSummary()).steps[2].completed).toBe(true);

    await pool.query('DELETE FROM "oauth_provider_config"');
    expect((await onboarding.getAdminSetupSummary()).steps[2].completed).toBe(false);

    process.env.GITHUB_CLIENT_ID = "env-client-id";
    expect((await onboarding.getAdminSetupSummary()).steps[2].completed).toBe(true);
    delete process.env.GITHUB_CLIENT_ID;
  });

  it("turns the abuse step off while a report is new or triaged", async () => {
    await pool.query(
      `INSERT INTO "abuse_report" ("id", "targetUrl", "category", "description", "status")
       VALUES ($1, $2, 'phishing', 'Test report', 'new')`,
      [`abuse-${RUN_ID}-1`, `https://abuse-${RUN_ID}.example.test`],
    );

    const open = await onboarding.getAdminSetupSummary();
    expect(open.pendingAbuseReports).toBe(1);
    expect(open.steps[0].completed).toBe(false);

    await pool.query(`UPDATE "abuse_report" SET "status" = 'resolved' WHERE "id" = $1`, [
      `abuse-${RUN_ID}-1`,
    ]);

    const cleared = await onboarding.getAdminSetupSummary();
    expect(cleared.pendingAbuseReports).toBe(0);
    expect(cleared.steps[0].completed).toBe(true);
  });
});
