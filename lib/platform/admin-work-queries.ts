import { randomUUID } from "node:crypto";
import { pool } from "./db";

/**
 * Admin write-side and filtered read projections: the incident board (the one
 * Forge surface that needed a new backend), the operations work list, the
 * telemetry error groups paas folds out of failed deployments and jobs, the
 * Build-log tail, and the account-plan acknowledgement. SQL and their Forge
 * wire mappings live here so tests can call them without HTTP.
 */

export type IncidentRow = {
  id: string;
  title: string;
  severity: "info" | "warning" | "critical";
  status: "investigating" | "identified" | "monitoring" | "resolved";
  services: string[];
  started_at: Date;
  resolved_at: Date | null;
  created_by_account_id: string | null;
  created_at: Date;
  updated_at: Date;
  events: {
    id: string;
    incident_id: string;
    kind: string;
    message: string;
    actor_account_id: string | null;
    /** jsonb_agg serializes to an ISO string, not a Date. */
    created_at: string | Date;
  }[];
};

export const VALID_SEVERITIES = new Set(["info", "warning", "critical"]);
export const VALID_STATUSES = new Set(["investigating", "identified", "monitoring", "resolved"]);
export const VALID_EVENT_KINDS = new Set([
  "alert",
  "deployment",
  "restart",
  "backup",
  "configuration",
  "monitor",
  "note",
]);

export type IncidentItem = {
  id: string;
  title: string;
  severity: string;
  status: string;
  services: string[];
  started_at: string;
  resolved_at?: string;
  created_by_account_id?: string;
  events: {
    id: string;
    incident_id: string;
    kind: string;
    message: string;
    actor_account_id?: string;
    created_at: string;
  }[];
  created_at: string;
  updated_at: string;
  /** Unused by the UI but kept for parity with the Forge payload. */
  admin_email: string;
};

export async function listIncidents(
  limit: number,
  adminEmail: string,
): Promise<{
  items: IncidentItem[];
}> {
  const result = await pool.query<IncidentRow>(`
      SELECT i."id",
             i."title",
             i."severity",
             i."status",
             i."services",
             i."startedAt" AS "started_at",
             i."resolvedAt" AS "resolved_at",
             i."createdByAccountId" AS "created_by_account_id",
             i."createdAt" AS "created_at",
             i."updatedAt" AS "updated_at",
             COALESCE((
               SELECT jsonb_agg(
                 jsonb_build_object(
                   'id', e."id",
                   'incident_id', e."incidentId",
                   'kind', e."kind",
                   'message', e."message",
                   'actor_account_id', e."actorAccountId",
                   'created_at', e."createdAt"
                 ) ORDER BY e."createdAt" ASC
               )
               FROM "admin_incident_event" e
               WHERE e."incidentId" = i."id"
             ), '[]'::jsonb) AS events
      FROM "admin_incident" i
      ORDER BY i."startedAt" DESC
      LIMIT ${limit}
    `);

  return {
    items: result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      severity: row.severity,
      status: row.status,
      services: row.services ?? [],
      started_at: row.started_at.toISOString(),
      ...(row.resolved_at ? { resolved_at: row.resolved_at.toISOString() } : {}),
      ...(row.created_by_account_id ? { created_by_account_id: row.created_by_account_id } : {}),
      events: (row.events ?? []).map((event) => {
        // jsonb_agg hands the timestamps back as ISO strings; accept both so a
        // future refactor to a real JOIN cannot silently break the wire shape.
        const eventCreatedAt = new Date(event.created_at).toISOString();
        return {
          id: event.id,
          incident_id: event.incident_id,
          kind: event.kind,
          message: event.message,
          ...(event.actor_account_id ? { actor_account_id: event.actor_account_id } : {}),
          created_at: eventCreatedAt,
        };
      }),
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      admin_email: adminEmail,
    })),
  };
}

export async function createIncident(input: {
  title: string;
  severity: string;
  status: string;
  services: string[];
  message?: string;
  createdByAccountId: string;
}): Promise<{ id: string }> {
  const incidentId = randomUUID();
  const now = new Date();

  await pool.query(
    `INSERT INTO "admin_incident"
         ("id", "title", "severity", "status", "services", "startedAt",
          "resolvedAt", "createdByAccountId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $6, $6)`,
    [
      incidentId,
      input.title,
      input.severity,
      input.status,
      JSON.stringify(input.services),
      now,
      input.status === "resolved" ? now : null,
      input.createdByAccountId,
    ],
  );

  // A new incident records its opening note the same way Forge does.
  if (input.message && input.message.trim() !== "") {
    await pool.query(
      `INSERT INTO "admin_incident_event"
           ("id", "incidentId", "kind", "message", "actorAccountId", "createdAt")
         VALUES ($1, $2, 'note', $3, $4, $5)`,
      [randomUUID(), incidentId, input.message.trim(), input.createdByAccountId, now],
    );
  }

  return { id: incidentId };
}

export async function updateIncidentStatus(incidentId: string, status: string): Promise<void> {
  const result = await pool.query(
    `UPDATE "admin_incident"
         SET "status" = $1,
             "resolvedAt" = CASE WHEN $1 = 'resolved' THEN now() ELSE "resolvedAt" END,
             "updatedAt" = now()
         WHERE "id" = $2`,
    [status, incidentId],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new IncidentNotFound();
  }
}

export class IncidentNotFound extends Error {
  constructor() {
    super("Incident not found.");
  }
}

export async function addIncidentEvent(input: {
  incidentId: string;
  kind: string;
  message: string;
  actorAccountId: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO "admin_incident_event"
         ("id", "incidentId", "kind", "message", "actorAccountId", "createdAt")
       VALUES ($1, $2, $3, $4, $5, now())`,
    [randomUUID(), input.incidentId, input.kind, input.message, input.actorAccountId],
  );
}

export type OperationsItem = {
  id: string;
  kind: string;
  name: string;
  project_id?: string;
  project_name?: string;
  status: string;
  started_at?: string;
  finished_at?: string;
  duration_ms: number;
  error?: string;
  created_at: string;
};

export type OperationsWindow = {
  /** Explicit ISO window from the Forge client, when present. */
  from?: string | null;
  to?: string | null;
  /** Fallback range in minutes when `from` is absent. */
  windowMinutes: number;
  limit: number;
};

export async function listOperations(window: OperationsWindow): Promise<{
  items: OperationsItem[];
}> {
  const { from, to, windowMinutes, limit } = window;

  // The job table records claims, not run windows: `lockedAt` is when the
  // worker took the job, `updatedAt` its last transition, so terminal jobs
  // derive finished_at from updatedAt and running jobs stay open.
  const operationsResult = await pool.query<{
    id: string;
    kind: string;
    name: string;
    project_id: string | null;
    project_name: string | null;
    status: string;
    started_at: Date | null;
    finished_at: Date | null;
    duration_ms: number;
    error: string | null;
    created_at: Date;
  }>(
    `
  SELECT * FROM (
    SELECT
      d."id",
      'app_deployment' AS kind,
      'deploy ' || s."name" AS name,
      p."id" AS project_id,
      p."name" AS project_name,
      d."status",
      d."startedAt" AS started_at,
      d."finishedAt" AS finished_at,
      GREATEST(
        0,
        (EXTRACT(EPOCH FROM (COALESCE(d."finishedAt", now()) - d."startedAt")) * 1000)::bigint
      ) AS duration_ms,
      d."errorMessage" AS error,
      d."createdAt" AS created_at
    FROM "deployment" d
    JOIN "service" s ON s."id" = d."serviceId"
    JOIN "project" p ON p."id" = s."projectId"
    WHERE d."createdAt" >= ${from ? "$1::timestamptz" : "now() - ($1 || ' minutes')::interval"}
      ${to ? `AND d."createdAt" <= $2::timestamptz` : ""}
    UNION ALL
    SELECT
      j."id",
      j."type" AS kind,
      j."type" || ' ' || COALESCE(
        j."payload"->>'deploymentId',
        j."payload"->>'backupId',
        j."payload"->>'restoreId',
        j."id"
      ) AS name,
      NULL::text AS project_id,
      NULL::text AS project_name,
      j."status",
      j."lockedAt" AS started_at,
      CASE
        WHEN j."status" IN ('succeeded', 'failed', 'cancelled')
          THEN j."updatedAt"
      END AS finished_at,
      GREATEST(
        0,
        (EXTRACT(EPOCH FROM (
          CASE
            WHEN j."status" IN ('succeeded', 'failed', 'cancelled')
              THEN j."updatedAt" - COALESCE(j."lockedAt", j."createdAt")
            ELSE now() - COALESCE(j."lockedAt", j."createdAt")
          END
        )) * 1000)::bigint
      ) AS duration_ms,
      j."lastError" AS error,
      j."createdAt" AS created_at
    FROM "job" j
    WHERE j."createdAt" >= ${from ? "$1::timestamptz" : "now() - ($1 || ' minutes')::interval"}
      ${to ? `AND j."createdAt" <= $2::timestamptz` : ""}
  ) operations
  ORDER BY "created_at" DESC
  LIMIT ${limit}
`,
    [from ?? String(windowMinutes), ...(to ? [to] : [])],
  );

  return {
    items: operationsResult.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      ...(row.project_id ? { project_id: row.project_id } : {}),
      ...(row.project_name ? { project_name: row.project_name } : {}),
      status: row.status,
      ...(row.started_at ? { started_at: row.started_at.toISOString() } : {}),
      ...(row.finished_at ? { finished_at: row.finished_at.toISOString() } : {}),
      duration_ms: Number(row.duration_ms),
      ...(row.error ? { error: row.error } : {}),
      created_at: row.created_at.toISOString(),
    })),
  };
}

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

export type ErrorGroupItem = {
  fingerprint: string;
  service: string;
  error_type: string;
  message: string;
  status: "open" | "acknowledged" | "resolved" | "ignored";
  first_seen: string;
  last_seen: string;
  occurrence_count: number;
};

export type ErrorGroupWindow = {
  from?: string | null;
  to?: string | null;
  /** Fallback range in hours when `from` is absent. */
  windowHours: number;
};

export async function listErrorGroups(window: ErrorGroupWindow): Promise<{
  items: ErrorGroupItem[];
}> {
  const { from, to, windowHours } = window;

  const result = await pool.query<{
    id: string;
    error_type: string;
    message: string;
    kind: string;
    first_seen: Date;
    last_seen: Date;
    occurrence_count: number;
  }>(
    `
  SELECT * FROM (
    SELECT
      'deployment' AS kind,
      'deployment' AS id,
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
      'job' AS id,
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
    [from ?? String(windowHours), ...(to ? [to] : [])],
  );

  const groups = new Map<
    string,
    {
      fingerprint: string;
      service: string;
      error_type: string;
      message: string;
      status: "open";
      first_seen_date: Date;
      last_seen_date: Date;
      occurrence_count: number;
    }
  >();

  for (const row of result.rows) {
    const fingerprint = fingerprintOf(row.kind, row.message);
    const existing = groups.get(fingerprint);
    if (existing) {
      existing.occurrence_count += row.occurrence_count;
      if (row.first_seen < existing.first_seen_date) existing.first_seen_date = row.first_seen;
      if (row.last_seen > existing.last_seen_date) existing.last_seen_date = row.last_seen;
    } else {
      groups.set(fingerprint, {
        fingerprint,
        service: row.kind === "job" ? "worker" : "build",
        error_type: errorTypeOf(row.message),
        message: row.message,
        status: "open",
        first_seen_date: row.first_seen,
        last_seen_date: row.last_seen,
        occurrence_count: row.occurrence_count,
      });
    }
  }

  return {
    items: [...groups.values()].map(({ first_seen_date, last_seen_date, ...group }) => ({
      ...group,
      first_seen: first_seen_date.toISOString(),
      last_seen: last_seen_date.toISOString(),
    })),
  };
}

const LOG_LEVELS = new Set(["INFO", "WARN", "ERROR", "DEBUG"]);

export const BUILD_LOG_LEVELS = LOG_LEVELS;

/** Derives the level from the message the same way Forge normalizes collector severities. */
export function normalizeLogLevel(message: string): string {
  if (/\berror\b|\bfatal\b/i.test(message)) return "ERROR";
  if (/\bwarn(ing)?\b/i.test(message)) return "WARN";
  if (/\bdebug\b/i.test(message)) return "DEBUG";
  return "INFO";
}

export type LogTailWindow = {
  from?: string | null;
  to?: string | null;
  service?: string | null;
  search?: string | null;
  limit: number;
};

export type LogTailItem = {
  timestamp: string;
  level: string;
  service: string;
  message: string;
};

export async function tailBuildLogs(window: LogTailWindow): Promise<{
  items: LogTailItem[];
}> {
  const { from, to, service, search, limit } = window;

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

  const result = await pool.query<{ timestamp: Date; message: string }>(
    `SELECT "createdAt" AS "timestamp", "message"
   FROM "build_log"
   ${whereClause}
   ORDER BY "createdAt" DESC
   LIMIT ${limit}`,
    params,
  );

  return {
    items: result.rows.map((row) => ({
      timestamp: row.timestamp.toISOString(),
      level: normalizeLogLevel(row.message),
      // The Build log is one stream; the console reads it as the control
      // plane's own, so every line reports the build service.
      service: service ?? "build",
      message: row.message,
    })),
  };
}

export type AccountPlanAcknowledgement = {
  id: string;
  email: string;
  email_verified: boolean;
  /** The requested plan, echoed so the UI's optimistic state holds. */
  plan: string;
  created_at: string;
  providers: string[];
  avatar_url?: string;
  display_name?: string;
};

/**
 * Reads one account for the plan transition. paas has no subscription plan
 * column, so the route only validates and acknowledges; the account keeps
 * rendering on the Free tier, which is the honest state of this instance.
 */
export async function getAccountForPlan(
  accountId: string,
): Promise<Omit<AccountPlanAcknowledgement, "plan"> | null> {
  const result = await pool.query<{
    id: string;
    email: string;
    emailVerified: boolean;
    createdAt: Date;
    image: string | null;
    name: string | null;
  }>(
    `SELECT u."id", u."email", u."emailVerified", u."createdAt",
          u."image", u."name"
   FROM "user" u WHERE u."id" = $1`,
    [accountId],
  );

  const account = result.rows[0];
  if (!account) return null;

  return {
    id: account.id,
    email: account.email,
    email_verified: account.emailVerified,
    created_at: account.createdAt.toISOString(),
    providers: [],
    ...(account.image ? { avatar_url: account.image } : {}),
    ...(account.name ? { display_name: account.name } : {}),
  };
}
