import { pool } from "@/lib/platform/db";
import { apiData, withAdmin } from "@/lib/platform/api";

/**
 * Admin error groups — mirrors stealth-forge's `/v1/admin/telemetry/errors`.
 * paas aggregates the one error store it has: failed deployments and failed
 * jobs are folded into error groups keyed by a normalized fingerprint, with
 * the Forge lifecycle statuses. A telemetry backend can replace the source of
 * this projection without changing the wire shape.
 */

type FailureRow = {
  id: string;
  error_type: string;
  message: string;
  kind: string;
  first_seen: Date;
  last_seen: Date;
  occurrence_count: number;
};

/** Collapses a runtime message to a stable group fingerprint. */
function fingerprintOf(kind: string, message: string): string {
  const normalized = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b\d+(\.\d+)+\b/g, "<version>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return `${kind}:${normalized}`;
}

function errorTypeOf(message: string): string {
  const match = message.match(/^([A-Za-z][A-Za-z0-9_.]*(Error|Exception|Failure))\b/);
  return match ? match[1] : "DeploymentError";
}

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const url = new URL(request.url);
    // The Forge client sends an explicit from/to window; fall back to the
    // range label when only that is present.
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const rawRange = url.searchParams.get("range") ?? "24h";
    const rangeHours: Record<string, number> = {
      "1h": 1,
      "6h": 6,
      "24h": 24,
      "7d": 24 * 7,
    };
    const hours = rangeHours[rawRange] ?? 24;

    const result = await pool.query<FailureRow>(
      `
  SELECT * FROM (
    SELECT
      'deployment' AS kind,
      d."id",
      COALESCE(d."errorMessage", 'Deployment failed') AS message,
      min(d."startedAt") AS "first_seen",
      max(d."finishedAt") AS "last_seen",
      count(*)::int AS "occurrence_count"
    FROM "deployment" d
    WHERE d."status" = 'failed'
      AND d."errorMessage" IS NOT NULL
      AND d."createdAt" >= ${from ? `$1::timestamptz` : "now() - ($1 || ' hours')::interval"}
      ${to ? `AND d."createdAt" <= $2::timestamptz` : ""}
    GROUP BY COALESCE(d."errorMessage", 'Deployment failed')
    UNION ALL
    SELECT
      'job' AS kind,
      j."type" AS "id",
      COALESCE(j."lastError", 'Job failed') AS message,
      min(j."createdAt") AS "first_seen",
      max(j."updatedAt") AS "last_seen",
      count(*)::int AS "occurrence_count"
    FROM "job" j
    WHERE j."status" = 'failed'
      AND j."lastError" IS NOT NULL
      AND j."createdAt" >= ${from ? `$1::timestamptz` : "now() - ($1 || ' hours')::interval"}
      ${to ? `AND j."createdAt" <= $2::timestamptz` : ""}
    GROUP BY j."type", COALESCE(j."lastError", 'Job failed')
  ) failures
  ORDER BY "last_seen" DESC
  LIMIT 250
`,
      to ? [from, to] : [from ?? String(hours)],
    );

    const groups = new Map<
      string,
      {
        fingerprint: string;
        service: string;
        error_type: string;
        message: string;
        status: "open" | "acknowledged" | "resolved" | "ignored";
        first_seen: Date;
        last_seen: Date;
        occurrence_count: number;
        trace_id?: string;
      }
    >();

    for (const row of result.rows) {
      const fingerprint = fingerprintOf(row.kind, row.message);
      const existing = groups.get(fingerprint);
      if (existing) {
        existing.occurrence_count += row.occurrence_count;
        if (row.first_seen < existing.first_seen) existing.first_seen = row.first_seen;
        if (row.last_seen > existing.last_seen) existing.last_seen = row.last_seen;
      } else {
        groups.set(fingerprint, {
          fingerprint,
          service: row.kind === "job" ? "worker" : "build",
          error_type: errorTypeOf(row.message),
          message: row.message,
          status: "open",
          first_seen: row.first_seen,
          last_seen: row.last_seen,
          occurrence_count: row.occurrence_count,
        });
      }
    }

    return apiData({ items: [...groups.values()] });
  });
}
