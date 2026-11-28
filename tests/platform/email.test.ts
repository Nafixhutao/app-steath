import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { prepareTestDatabase } from "../helpers/database";

/**
 * The email outbox against a real PostgreSQL and stubbed provider APIs. The
 * important contracts are: secrets stay sealed, the row id is the idempotency
 * key, and quota exhaustion moves the next message to the fallback provider.
 */

process.env.ENV_ENCRYPTION_KEY ??= "a".repeat(64);

let pool: Pool;
let settings: typeof import("@/lib/platform/email-settings");
let mailer: typeof import("@/lib/platform/mailer");

const fetchMock = vi.fn();

beforeAll(async () => {
  await prepareTestDatabase();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // The scratch database survives between runs, so each pass starts from the
  // migration's seeded state instead of inheriting the previous run's config.
  await pool.query(`UPDATE "email_provider" SET "enabled" = false,
    "apiKeyEncrypted" = NULL, "apiSecretEncrypted" = NULL, "fromEmail" = '',
    "fromName" = 'Stealth', "monthlyLimit" = CASE "provider" WHEN 'resend' THEN 3000 ELSE 6000 END,
    "dailyLimit" = CASE "provider" WHEN 'resend' THEN 100 ELSE 200 END,
    "usedMonth" = 0, "usedDay" = 0, "quotaMonth" = '', "quotaDay" = '',
    "lastError" = NULL, "lastTestedAt" = NULL,
    "priority" = CASE "provider" WHEN 'resend' THEN 1 ELSE 2 END`);
  await pool.query('DELETE FROM "email_outbox"');
  settings = await import("@/lib/platform/email-settings");
  mailer = await import("@/lib/platform/mailer");
});

afterAll(async () => {
  if (pool) {
    await pool.query('DELETE FROM "email_outbox"');
    await pool.end();
  }
  vi.unstubAllGlobals();
});

async function configureResend() {
  return settings.updateEmailProvider({
    provider: "resend",
    enabled: true,
    priority: 1,
    apiKey: "re_test_secret_key",
    fromEmail: "no-reply@example.test",
    fromName: "Stealth Test",
    monthlyLimit: 10,
    dailyLimit: 5,
  });
}

async function configureMailjet() {
  return settings.updateEmailProvider({
    provider: "mailjet",
    enabled: true,
    priority: 2,
    apiKey: "mailjet_public_key",
    apiSecret: "mailjet_private_secret",
    fromEmail: "no-reply@example.test",
    fromName: "Stealth Test",
    monthlyLimit: 20,
    dailyLimit: 10,
  });
}

function resendOk() {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ id: "msg-resend-1" }),
  });
}

describe("email provider settings", () => {
  it("seeds both providers and masks stored credentials", async () => {
    const providers = await settings.listEmailProviders();
    expect(providers.map((p) => p.provider)).toEqual(["resend", "mailjet"]);
    expect(providers.every((p) => p.keyPreview === "" || p.keyPreview === "********")).toBe(true);
  });

  it("refuses to enable a provider without credentials", async () => {
    await expect(
      settings.updateEmailProvider({ provider: "resend", enabled: true, fromEmail: "a@b.test" }),
    ).rejects.toMatchObject({ code: "email_provider_incomplete", status: 400 });
  });

  it("seals the API key and keeps it when a later update leaves it blank", async () => {
    const configured = await configureResend();
    expect(configured.hasKey).toBe(true);
    expect(configured.configured).toBe(true);

    const stored = await pool.query<{ apiKeyEncrypted: string }>(
      'SELECT "apiKeyEncrypted" FROM "email_provider" WHERE "provider" = $1',
      ["resend"],
    );
    expect(stored.rows[0]!.apiKeyEncrypted).not.toContain("re_test_secret_key");

    await settings.updateEmailProvider({ provider: "resend", fromName: "Stealth Renamed" });
    const credentials = await settings.getEmailCredentials("resend");
    expect(credentials?.apiKey).toBe("re_test_secret_key");
    expect(credentials?.fromName).toBe("Stealth Renamed");
  });
});

describe("outbox delivery", () => {
  beforeAll(async () => {
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends through the primary provider with the row id as idempotency key", async () => {
    await configureResend();
    await settings.updateEmailProvider({ provider: "mailjet", enabled: false });
    resendOk();

    const id = await mailer.enqueueEmail({
      to: "customer@example.test",
      subject: "Verify your email",
      html: "<p>Verify</p>",
    });
    const result = await mailer.processOutboxBatch(5);
    expect(result.sent).toBe(1);

    const row = await pool.query<{ status: string; provider: string; providerMessageId: string }>(
      'SELECT "status", "provider", "providerMessageId" FROM "email_outbox" WHERE "id" = $1',
      [id],
    );
    expect(row.rows[0]).toMatchObject({
      status: "sent",
      provider: "resend",
      providerMessageId: "msg-resend-1",
    });

    const call = fetchMock.mock.calls.at(-1)!;
    expect(call[0]).toBe("https://api.resend.com/emails");
    expect(call[1].headers["Idempotency-Key"]).toBe(id);
    expect(call[1].headers.Authorization).toBe("Bearer re_test_secret_key");
  });

  it("falls back to Mailjet when the primary's local quota is exhausted", async () => {
    await configureResend();
    await configureMailjet();
    await pool.query(
      'UPDATE "email_provider" SET "usedMonth" = "monthlyLimit" WHERE "provider" = $1',
      ["resend"],
    );
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          Messages: [{ Status: "success", To: [{ MessageUUID: "msg-mailjet-1" }] }],
        }),
    });

    const id = await mailer.enqueueEmail({
      to: "customer@example.test",
      subject: "Reset password",
      html: "<p>Reset</p>",
    });
    expect((await mailer.processOutboxBatch(5)).sent).toBe(1);

    const row = await pool.query<{ provider: string; providerMessageId: string }>(
      'SELECT "provider", "providerMessageId" FROM "email_outbox" WHERE "id" = $1',
      [id],
    );
    expect(row.rows[0]).toMatchObject({ provider: "mailjet", providerMessageId: "msg-mailjet-1" });

    const call = fetchMock.mock.calls.at(-1)!;
    expect(call[0]).toBe("https://api.mailjet.com/v3.1/send");
    expect(JSON.parse(call[1].body).Messages[0].CustomID).toBe(id);
  });

  it("retries a provider refusal without losing the message", async () => {
    await configureResend();
    await settings.updateEmailProvider({ provider: "mailjet", enabled: false });
    await pool.query('UPDATE "email_provider" SET "usedMonth" = 0, "usedDay" = 0');
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "provider refused",
    });

    const id = await mailer.enqueueEmail({
      to: "customer@example.test",
      subject: "Retry me",
      html: "<p>Retry</p>",
    });
    const result = await mailer.processOutboxBatch(5);
    expect(result.sent).toBe(0);
    expect(result.retried).toBe(1);

    const row = await pool.query<{ status: string; attempts: number; lastError: string }>(
      'SELECT "status", "attempts", "lastError" FROM "email_outbox" WHERE "id" = $1',
      [id],
    );
    expect(row.rows[0]).toMatchObject({ status: "queued", attempts: 1 });
    expect(row.rows[0]!.lastError).toContain("provider refused");
  });
});
