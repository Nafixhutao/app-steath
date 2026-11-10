import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { ApiError } from "@/lib/platform/api";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const categories = ["malware", "phishing", "spam", "copyright", "other"] as const;
export type AbuseCategory = (typeof categories)[number];
export type AbuseStatus = "new" | "triaged" | "resolved" | "dismissed";

export function validateAbuseCategory(value: unknown): value is AbuseCategory {
  return typeof value === "string" && categories.includes(value as AbuseCategory);
}

function cleanText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

export async function createAbuseReport(input: {
  targetUrl: unknown;
  category: unknown;
  description: unknown;
  reporterEmail?: unknown;
  challengeAnswer: unknown;
  ip: string;
}) {
  if (input.challengeAnswer !== "7")
    throw new ApiError(400, "challenge_failed", "The spam challenge answer is incorrect.");
  if (
    !cleanText(input.targetUrl, 2048) ||
    !validateAbuseCategory(input.category) ||
    !cleanText(input.description, 5000)
  ) {
    throw new ApiError(
      400,
      "invalid_report",
      "Provide a valid target URL, category, and description.",
    );
  }
  let target: URL;
  try {
    target = new URL(input.targetUrl.trim());
  } catch {
    throw new ApiError(400, "invalid_target_url", "Target URL must be a valid HTTP or HTTPS URL.");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:")
    throw new ApiError(400, "invalid_target_url", "Target URL must use HTTP or HTTPS.");
  let email: string | null = null;
  if (input.reporterEmail !== undefined && input.reporterEmail !== "") {
    if (
      typeof input.reporterEmail !== "string" ||
      input.reporterEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.reporterEmail)
    ) {
      throw new ApiError(400, "invalid_email", "Reporter email is invalid.");
    }
    email = input.reporterEmail.trim().toLowerCase();
  }
  const ipHash = createHash("sha256").update(input.ip).digest("hex");
  // A rolling hour, not a calendar hour: a fixed window lets six reports
  // through across a boundary (e.g. 09:59 and 10:01). Counts are bucketed per
  // minute and summed over the last 60 minutes. The advisory lock serialises
  // concurrent submissions from the same IP, and the report insert shares the
  // transaction so a failed write never consumes quota.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ipHash]);
    const recent = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM("count"), 0) AS total FROM "abuse_report_rate_limit"
       WHERE "ipHash" = $1 AND "windowStartedAt" > now() - interval '1 hour'`,
      [ipHash],
    );
    if (Number(recent.rows[0].total) >= 3)
      throw new ApiError(
        429,
        "rate_limited",
        "You can submit at most three abuse reports per hour.",
      );
    await client.query(
      `INSERT INTO "abuse_report_rate_limit" ("ipHash", "windowStartedAt", "count")
       VALUES ($1, date_trunc('minute', now()), 1)
       ON CONFLICT ("ipHash", "windowStartedAt") DO UPDATE
         SET "count" = "abuse_report_rate_limit"."count" + 1`,
      [ipHash],
    );
    const id = randomUUID();
    await client.query(
      `INSERT INTO "abuse_report" ("id", "targetUrl", "category", "description", "reporterEmail") VALUES ($1,$2,$3,$4,$5)`,
      [id, target.toString(), input.category, input.description.trim(), email],
    );
    await client.query("COMMIT");
    return { id, status: "new" as const };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listAbuseReports(status?: AbuseStatus) {
  const result = await pool.query(
    `SELECT "id", "targetUrl", "category", "description", "reporterEmail", "status", "createdAt", "updatedAt"
    FROM "abuse_report" WHERE ($1::text IS NULL OR "status" = $1) ORDER BY "createdAt" DESC LIMIT 500`,
    [status ?? null],
  );
  return result.rows;
}

export async function updateAbuseReport(id: string, status: AbuseStatus) {
  const result = await pool.query(
    `UPDATE "abuse_report" SET "status"=$2,"updatedAt"=now() WHERE "id"=$1 RETURNING "id","targetUrl","status"`,
    [id, status],
  );
  if (!result.rowCount) throw new ApiError(404, "report_not_found", "Abuse Report not found.");
  return result.rows[0];
}
