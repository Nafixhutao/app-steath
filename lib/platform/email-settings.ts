import { pool } from "./db.ts";
import { ApiError } from "./api-error.ts";
import { decryptSecret, encryptSecret, MASKED_VALUE } from "./secrets.ts";

/**
 * Provider credentials and free-tier counters. This is the Control Plane's
 * source of truth for email: the Admin Console writes it, the worker reads it.
 * Secrets are sealed with the platform key, so a database read never exposes
 * a provider API key.
 */

export type MailProviderId = "resend" | "mailjet";

export const MAIL_PROVIDERS: readonly MailProviderId[] = ["resend", "mailjet"];

type ProviderRow = {
  provider: MailProviderId;
  enabled: boolean;
  priority: number;
  apiKeyEncrypted: string | null;
  apiSecretEncrypted: string | null;
  fromEmail: string;
  fromName: string;
  monthlyLimit: number;
  dailyLimit: number;
  usedMonth: number;
  usedDay: number;
  quotaMonth: string;
  quotaDay: string;
  lastError: string | null;
  lastTestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const COLUMNS = `"provider", "enabled", "priority", "apiKeyEncrypted", "apiSecretEncrypted",
  "fromEmail", "fromName", "monthlyLimit", "dailyLimit", "usedMonth", "usedDay",
  "quotaMonth", "quotaDay", "lastError", "lastTestedAt", "createdAt", "updatedAt"`;

/** Everything the Admin Console may show. Keys are replaced by a fixed mask. */
export type EmailProviderSummary = {
  provider: MailProviderId;
  enabled: boolean;
  priority: number;
  fromEmail: string;
  fromName: string;
  monthlyLimit: number;
  dailyLimit: number;
  usedMonth: number;
  usedDay: number;
  hasKey: boolean;
  hasSecret: boolean;
  keyPreview: string;
  lastError: string | null;
  lastTestedAt: string | null;
  configured: boolean;
};

function today(): { month: string; day: string } {
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  return { month, day: month + "-" + now.toISOString().slice(8, 10) };
}

function toSummary(row: ProviderRow): EmailProviderSummary {
  const hasKey = Boolean(row.apiKeyEncrypted);
  const configured = hasKey && (row.provider !== "mailjet" || Boolean(row.apiSecretEncrypted));
  return {
    provider: row.provider,
    enabled: row.enabled,
    priority: row.priority,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    monthlyLimit: row.monthlyLimit,
    dailyLimit: row.dailyLimit,
    usedMonth: row.usedMonth,
    usedDay: row.usedDay,
    hasKey,
    hasSecret: Boolean(row.apiSecretEncrypted),
    keyPreview: hasKey ? MASKED_VALUE : "",
    lastError: row.lastError,
    lastTestedAt: row.lastTestedAt ? row.lastTestedAt.toISOString() : null,
    configured,
  };
}

function assertProvider(value: unknown): MailProviderId {
  if (value !== "resend" && value !== "mailjet") {
    throw new ApiError(404, "email_provider_not_found", "Unknown email provider.");
  }
  return value;
}

function limit(value: unknown, fallback: number, field: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ApiError(400, "invalid_email_limit", `${field} must be a positive whole number.`);
  }
  return value;
}

/** Rolls stale daily/monthly counters forward. Safe to call on every read. */
async function refreshCounters(): Promise<void> {
  const { month, day } = today();
  await pool.query(
    `UPDATE "email_provider"
     SET "usedMonth" = CASE WHEN "quotaMonth" = $1 THEN "usedMonth" ELSE 0 END,
         "usedDay" = CASE WHEN "quotaDay" = $2 THEN "usedDay" ELSE 0 END,
         "quotaMonth" = $1, "quotaDay" = $2`,
    [month, day],
  );
}

/** Lists both providers with counters and masks, for the Admin Console. */
export async function listEmailProviders(): Promise<EmailProviderSummary[]> {
  await refreshCounters();
  const result = await pool.query<ProviderRow>(
    `SELECT ${COLUMNS} FROM "email_provider" ORDER BY "priority", "provider"`,
  );
  return result.rows.map(toSummary);
}

/**
 * Updates one provider. Empty secret fields keep the stored value, so an admin
 * can toggle a flag without retyping a key. A provider can only be enabled
 * when it has the credentials it needs and a From address.
 */
export async function updateEmailProvider(input: {
  provider: unknown;
  enabled?: unknown;
  priority?: unknown;
  apiKey?: unknown;
  apiSecret?: unknown;
  fromEmail?: unknown;
  fromName?: unknown;
  monthlyLimit?: unknown;
  dailyLimit?: unknown;
}): Promise<EmailProviderSummary> {
  const provider = assertProvider(input.provider);
  const existing = await pool.query<ProviderRow>(
    `SELECT ${COLUMNS} FROM "email_provider" WHERE "provider" = $1`,
    [provider],
  );
  const row = existing.rows[0];
  if (!row) throw new ApiError(404, "email_provider_not_found", "Unknown email provider.");

  const apiKey =
    typeof input.apiKey === "string" && input.apiKey.trim() ? input.apiKey.trim() : null;
  const apiSecret =
    typeof input.apiSecret === "string" && input.apiSecret.trim() ? input.apiSecret.trim() : null;
  const fromEmail =
    input.fromEmail === undefined ? row.fromEmail : String(input.fromEmail ?? "").trim();
  const fromName =
    input.fromName === undefined ? row.fromName : String(input.fromName ?? "").trim();
  const enabled = input.enabled === undefined ? row.enabled : input.enabled === true;
  const priority = limit(input.priority, row.priority, "Priority");
  const monthlyLimit = limit(input.monthlyLimit, row.monthlyLimit, "Monthly limit");
  const dailyLimit = limit(input.dailyLimit, row.dailyLimit, "Daily limit");

  if (fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
    throw new ApiError(400, "invalid_from_email", "Enter a valid From email address.");
  }
  if (fromEmail.length > 254 || fromName.length > 100) {
    throw new ApiError(400, "invalid_sender", "The From address or name is too long.");
  }

  const hasKey = Boolean(apiKey) || Boolean(row.apiKeyEncrypted);
  const hasSecret = provider !== "mailjet" || Boolean(apiSecret) || Boolean(row.apiSecretEncrypted);
  if (enabled && (!hasKey || !hasSecret || !fromEmail)) {
    throw new ApiError(
      400,
      "email_provider_incomplete",
      "Fill in the API credentials and From address before enabling this provider.",
    );
  }

  const updated = await pool.query<ProviderRow>(
    `UPDATE "email_provider"
     SET "enabled" = $2, "priority" = $3,
         "apiKeyEncrypted" = COALESCE($4, "apiKeyEncrypted"),
         "apiSecretEncrypted" = COALESCE($5, "apiSecretEncrypted"),
         "fromEmail" = $6, "fromName" = $7,
         "monthlyLimit" = $8, "dailyLimit" = $9, "lastError" = NULL
     WHERE "provider" = $1
     RETURNING ${COLUMNS}`,
    [
      provider,
      enabled,
      priority,
      apiKey ? encryptSecret(apiKey) : null,
      apiSecret ? encryptSecret(apiSecret) : null,
      fromEmail,
      fromName,
      monthlyLimit,
      dailyLimit,
    ],
  );

  return toSummary(updated.rows[0]);
}

/** Decrypted credentials for the worker. Never logged, never returned by an API. */
export async function getEmailCredentials(
  provider: MailProviderId,
  includeDisabled = false,
): Promise<{
  apiKey: string;
  apiSecret: string;
  fromEmail: string;
  fromName: string;
} | null> {
  const result = await pool.query<ProviderRow>(
    `SELECT ${COLUMNS} FROM "email_provider"
     WHERE "provider" = $1 AND ($2::boolean OR "enabled" = true)`,
    [provider, includeDisabled],
  );
  const row = result.rows[0];
  if (!row?.apiKeyEncrypted || !row.fromEmail) return null;
  if (provider === "mailjet" && !row.apiSecretEncrypted) return null;

  return {
    apiKey: decryptSecret(row.apiKeyEncrypted),
    apiSecret: row.apiSecretEncrypted ? decryptSecret(row.apiSecretEncrypted) : "",
    fromEmail: row.fromEmail,
    fromName: row.fromName || "Stealth",
  };
}

/**
 * Picks the highest-priority enabled provider that still has quota. `preferred`
 * is used by the Admin Console's Test button, which may target a disabled or
 * exhausted provider deliberately.
 */
export async function pickEmailProvider(
  preferred?: MailProviderId | null,
): Promise<MailProviderId | null> {
  await refreshCounters();
  const result = await pool.query<{ provider: MailProviderId }>(
    `SELECT "provider" FROM "email_provider"
     WHERE "enabled" = true AND "usedMonth" < "monthlyLimit" AND "usedDay" < "dailyLimit"
       AND ($1::text IS NULL OR "provider" = $1)
     ORDER BY "priority", "provider" LIMIT 1`,
    [preferred ?? null],
  );
  return result.rows[0]?.provider ?? null;
}

/** Records a successful send against the provider's local free-tier counter. */
export async function recordEmailSent(provider: MailProviderId): Promise<void> {
  const { month, day } = today();
  await pool.query(
    `UPDATE "email_provider"
     SET "usedMonth" = CASE WHEN "quotaMonth" = $2 THEN "usedMonth" + 1 ELSE 1 END,
         "usedDay" = CASE WHEN "quotaDay" = $3 THEN "usedDay" + 1 ELSE 1 END,
         "quotaMonth" = $2, "quotaDay" = $3, "lastError" = NULL
     WHERE "provider" = $1`,
    [provider, month, day],
  );
}

/** Records a failure so the Admin Console can show why a provider was skipped. */
export async function recordEmailFailure(provider: MailProviderId, error: string): Promise<void> {
  await pool.query('UPDATE "email_provider" SET "lastError" = $2 WHERE "provider" = $1', [
    provider,
    error.slice(0, 500),
  ]);
}

/** Marks a provider as locally exhausted after a provider-side 429. */
export async function exhaustEmailProvider(provider: MailProviderId): Promise<void> {
  await pool.query(
    `UPDATE "email_provider" SET "usedMonth" = "monthlyLimit", "lastError" = $2
     WHERE "provider" = $1`,
    [provider, "Daily or monthly provider quota reached; skipped until the next period."],
  );
}

export async function markEmailProviderTested(provider: MailProviderId): Promise<void> {
  await pool.query('UPDATE "email_provider" SET "lastTestedAt" = now() WHERE "provider" = $1', [
    provider,
  ]);
}
