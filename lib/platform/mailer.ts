import { randomUUID } from "node:crypto";
import { pool } from "./db.ts";
import { ApiError } from "./api-error.ts";
import {
  exhaustEmailProvider,
  getEmailCredentials,
  markEmailProviderTested,
  pickEmailProvider,
  recordEmailSent,
  type MailProviderId,
} from "./email-settings.ts";

/**
 * Outbox-backed transactional email. A message is stored before any provider
 * is called, so a crash or a timeout can never lose it. The row id is used as
 * Resend's Idempotency-Key and Mailjet's CustomID, which prevents a retried
 * message from being delivered twice.
 */

type OutboxRow = {
  id: string;
  toEmail: string;
  subject: string;
  html: string;
  text: string;
  status: "queued" | "sending" | "sent" | "failed";
  provider: MailProviderId | null;
  providerMessageId: string | null;
  attempts: number;
  lastError: string | null;
};

const COLUMNS = `"id", "toEmail", "subject", "html", "text", "status", "provider",
  "providerMessageId", "attempts", "lastError"`;

/** A provider-side 429. No email was accepted, so another provider may try. */
class ProviderQuotaError extends Error {}

/** Any other provider refusal. The message has already been redacted. */
class ProviderSendError extends Error {}

export type MailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

function sanitize(value: string, secrets: string[]): string {
  let result = value;
  for (const secret of secrets) {
    if (secret.length >= 4) result = result.replaceAll(secret, "***");
  }
  return result.slice(0, 400);
}

function fromHeader(credentials: { fromEmail: string; fromName: string }): string {
  return credentials.fromName
    ? `${credentials.fromName} <${credentials.fromEmail}>`
    : credentials.fromEmail;
}

async function deliverWithResend(
  row: OutboxRow,
  credentials: { apiKey: string; fromEmail: string; fromName: string },
): Promise<string> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": row.id,
    },
    body: JSON.stringify({
      from: fromHeader(credentials),
      to: [row.toEmail],
      subject: row.subject,
      html: row.html,
      text: row.text,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const body = await response.text();
  if (response.status === 429) throw new ProviderQuotaError("provider quota reached");
  if (!response.ok) {
    throw new ProviderSendError(sanitize(body || `HTTP ${response.status}`, [credentials.apiKey]));
  }

  try {
    const parsed = JSON.parse(body) as { id?: string };
    if (!parsed.id) throw new Error("missing id");
    return parsed.id;
  } catch {
    throw new ProviderSendError("Resend accepted the message but returned no message id.");
  }
}

async function deliverWithMailjet(
  row: OutboxRow,
  credentials: { apiKey: string; apiSecret: string; fromEmail: string; fromName: string },
): Promise<string> {
  const basic = Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString("base64");
  const response = await fetch("https://api.mailjet.com/v3.1/send", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      Messages: [
        {
          From: { Email: credentials.fromEmail, Name: credentials.fromName || "Stealth" },
          To: [{ Email: row.toEmail }],
          Subject: row.subject,
          HTMLPart: row.html,
          TextPart: row.text,
          CustomID: row.id,
        },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const body = await response.text();
  if (response.status === 429) throw new ProviderQuotaError("provider quota reached");
  if (!response.ok) {
    throw new ProviderSendError(
      sanitize(body || `HTTP ${response.status}`, [credentials.apiKey, credentials.apiSecret]),
    );
  }

  try {
    const parsed = JSON.parse(body) as {
      Messages?: Array<{ Status?: string; To?: Array<{ MessageUUID?: string }> }>;
    };
    const message = parsed.Messages?.[0];
    const id = message?.To?.[0]?.MessageUUID;
    if (message?.Status !== "success" || !id) {
      throw new Error("provider refused the message");
    }
    return id;
  } catch {
    throw new ProviderSendError("Mailjet accepted the message but returned no message id.");
  }
}

async function deliver(
  row: OutboxRow,
  provider: MailProviderId,
  includeDisabled = false,
): Promise<string> {
  const credentials = await getEmailCredentials(provider, includeDisabled);
  if (!credentials) {
    throw new ProviderSendError("The provider has no API credentials or From address configured.");
  }

  if (provider === "resend") return deliverWithResend(row, credentials);
  return deliverWithMailjet(row, credentials);
}

/** Stores a message in the outbox. No provider is contacted here. */
export async function enqueueEmail(input: MailInput): Promise<string> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to)) {
    throw new ApiError(400, "invalid_recipient", "Enter a valid recipient email address.");
  }
  if (!input.subject.trim() || !input.html.trim()) {
    throw new ApiError(400, "invalid_email", "A subject and HTML body are required.");
  }

  const id = randomUUID();
  await pool.query(
    `INSERT INTO "email_outbox" ("id", "toEmail", "subject", "html", "text")
     VALUES ($1, $2, $3, $4, $5)`,
    [id, input.to.trim(), input.subject.trim(), input.html, input.text ?? ""],
  );

  return id;
}

async function loadOutboxRow(id: string): Promise<OutboxRow> {
  const result = await pool.query<OutboxRow>(
    `SELECT ${COLUMNS} FROM "email_outbox" WHERE "id" = $1`,
    [id],
  );
  if (!result.rows[0]) throw new ApiError(404, "email_not_found", "Email not found.");
  return result.rows[0];
}

async function deliverOutboxRow(
  row: OutboxRow,
  preferred?: MailProviderId | null,
  includeDisabled = false,
): Promise<{ provider: MailProviderId; messageId: string }> {
  const attempted = new Set<MailProviderId>();
  // At most two attempts: the chosen provider, then one fallback after a 429.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const provider =
      attempt === 0 ? (preferred ?? (await pickEmailProvider())) : await pickEmailProvider();
    if (!provider || attempted.has(provider)) {
      throw new ProviderSendError(
        "No email provider has quota left. Configure one in Admin Settings.",
      );
    }
    attempted.add(provider);

    try {
      const messageId = await deliver(row, provider, includeDisabled);
      await recordEmailSent(provider);
      return { provider, messageId };
    } catch (error) {
      if (error instanceof ProviderQuotaError && !includeDisabled) {
        await exhaustEmailProvider(provider);
        continue;
      }
      throw error;
    }
  }

  throw new ProviderSendError("No email provider has quota left. Configure one in Admin Settings.");
}

function markSent(id: string, provider: MailProviderId, messageId: string): Promise<void> {
  return pool
    .query(
      `UPDATE "email_outbox"
       SET "status" = 'sent', "provider" = $2, "providerMessageId" = $3,
           "sentAt" = now(), "lastError" = NULL
       WHERE "id" = $1`,
      [id, provider, messageId],
    )
    .then(() => undefined);
}

function markFailure(row: OutboxRow, error: string): Promise<void> {
  const exhausted = row.attempts >= 5;
  const backoffMinutes = Math.min(60, 2 ** Math.max(1, row.attempts));
  return pool
    .query(
      `UPDATE "email_outbox"
       SET "status" = $2, "lastError" = $3,
           "nextAttemptAt" = now() + ($4 * interval '1 minute')
       WHERE "id" = $1`,
      [
        row.id,
        exhausted ? "failed" : "queued",
        sanitize(error, []),
        exhausted ? 0 : backoffMinutes,
      ],
    )
    .then(() => undefined);
}

/**
 * Claims up to `limit` messages with SKIP LOCKED and delivers each one. Safe
 * to call from the worker every 30 seconds and from the Admin Console's Test
 * button. 'sending' rows older than 5 minutes are reclaimed after a crash.
 */
export async function processOutboxBatch(limit = 10): Promise<{
  sent: number;
  retried: number;
  failed: number;
}> {
  const claimed = await pool.query<OutboxRow>(
    `UPDATE "email_outbox"
     SET "status" = 'sending', "attempts" = "attempts" + 1
     WHERE "id" IN (
       SELECT "id" FROM "email_outbox"
       WHERE ("status" = 'queued' OR ("status" = 'sending' AND "updatedAt" < now() - interval '5 minutes'))
         AND "nextAttemptAt" <= now()
       ORDER BY "createdAt" ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING ${COLUMNS}`,
    [limit],
  );

  const result = { sent: 0, retried: 0, failed: 0 };
  for (const row of claimed.rows) {
    try {
      const delivered = await deliverOutboxRow(row);
      await markSent(row.id, delivered.provider, delivered.messageId);
      result.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markFailure(row, message);
      if (row.attempts >= 5) result.failed += 1;
      else result.retried += 1;
    }
  }

  return result;
}

/**
 * Sends a short test message through one specific provider immediately. The
 * message still goes through the outbox, so its id and result can be shown in
 * the Admin Console. A disabled provider may be tested before enabling it.
 */
export async function sendTestEmail(input: {
  to: string;
  provider: MailProviderId;
}): Promise<{ id: string; provider: MailProviderId; messageId: string }> {
  const id = await enqueueEmail({
    to: input.to,
    subject: "Stealth email test",
    html: "<p>This is a test email from your Stealth Admin Console.</p>",
    text: "This is a test email from your Stealth Admin Console.",
  });

  const row = await loadOutboxRow(id);
  try {
    const delivered = await deliverOutboxRow(row, input.provider, true);
    await markSent(id, delivered.provider, delivered.messageId);
    await markEmailProviderTested(input.provider);
    return { id, provider: delivered.provider, messageId: delivered.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markFailure(row, message);
    throw new ApiError(502, "email_test_failed", message);
  }
}

export type EmailOutboxSummary = {
  id: string;
  toEmail: string;
  subject: string;
  status: OutboxRow["status"];
  provider: MailProviderId | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
};

/** Recent outbox rows for the Admin Console's delivery monitor. */
export async function listEmailOutbox(limit = 30): Promise<EmailOutboxSummary[]> {
  const result = await pool.query<{
    id: string;
    toEmail: string;
    subject: string;
    status: OutboxRow["status"];
    provider: MailProviderId | null;
    attempts: number;
    lastError: string | null;
    createdAt: Date;
    sentAt: Date | null;
  }>(
    `SELECT "id", "toEmail", "subject", "status", "provider", "attempts", "lastError",
            "createdAt", "sentAt"
     FROM "email_outbox" ORDER BY "createdAt" DESC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)],
  );

  return result.rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
  }));
}

/** Manual retry for a failed outbox row, used from the Admin Console. */
export async function retryEmail(id: string): Promise<void> {
  const row = await loadOutboxRow(id);
  if (row.status === "sent") return;
  await pool.query(
    `UPDATE "email_outbox"
     SET "status" = 'queued', "attempts" = 0, "nextAttemptAt" = now(), "lastError" = NULL
     WHERE "id" = $1`,
    [id],
  );
}
