import { pool } from "@/lib/platform/db";
import { apiData, withAdmin } from "@/lib/platform/api";

/**
 * Admin log tail — mirrors stealth-forge's `/v1/admin/telemetry/logs`. Forge
 * reads an OTLP collector; paas has no telemetry backend, so the tail reads
 * the Build log lines the worker already streams into `build_log` (the one log
 * store paas has). `from`/`to` bound the window, `service`/`query` filter it
 * exactly like the source endpoint. `build_log` has no level column, so the
 * level is derived from the message the same way Forge's adapter normalizes
 * collector severities.
 */

const LEVELS = new Set(["INFO", "WARN", "ERROR", "DEBUG"]);

type BuildLogRow = {
  timestamp: Date;
  message: string;
};

function normalizeLogLevel(message: string): string {
  if (/\berror\b|\bfatal\b/i.test(message)) return "ERROR";
  if (/\bwarn(ing)?\b/i.test(message)) return "WARN";
  if (/\bdebug\b/i.test(message)) return "DEBUG";
  return "INFO";
}

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const service = url.searchParams.get("service");
    const level = url.searchParams.get("level")?.toUpperCase() ?? null;
    const search = url.searchParams.get("query");
    const rawLimit = url.searchParams.get("limit");
    let limit = 250;
    if (rawLimit !== null && rawLimit !== "") {
      limit = Number.parseInt(rawLimit, 10);
      if (!Number.isFinite(limit) || limit < 1) limit = 250;
    }
    limit = Math.min(limit, 1000);

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (from) {
      params.push(from);
      conditions.push(`"createdAt" >= $${params.length}::timestamptz`);
    }
    if (to) {
      params.push(to);
      conditions.push(`"createdAt" <= $${params.length}::timestamptz`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`"message" ILIKE $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query<BuildLogRow>(
      `SELECT "createdAt" AS "timestamp", "message"
   FROM "build_log"
   ${whereClause}
   ORDER BY "createdAt" DESC
   LIMIT ${limit}`,
      params,
    );

    const items = result.rows
      .map((row) => ({
        timestamp: row.timestamp.toISOString(),
        level: normalizeLogLevel(row.message),
        // The Build log is one stream; the console reads it as the control
        // plane's own, so every line reports the build service.
        service: service ?? "build",
        message: row.message,
      }))
      .filter((item) => (level ? LEVELS.has(level) && item.level === level : true));

    return apiData({ items });
  });
}
