import { randomUUID } from "node:crypto";
import { pool } from "@/lib/platform/db";
import { ApiError, apiData, withAdmin } from "@/lib/platform/api";

/**
 * Admin incidents — mirrors stealth-forge's `/v1/admin/incidents` board: the
 * incident list with each incident's event history, creation, and status
 * transitions. paas stores incidents in its own tables (this is the one Forge
 * surface that needed a new backend), and the wire shapes match the Forge
 * OpenAPI exactly so the ported components render unmodified.
 */

type IncidentRow = {
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
    created_at: Date;
  }[];
};

const VALID_SEVERITIES = new Set(["info", "warning", "critical"]);
const VALID_STATUSES = new Set(["investigating", "identified", "monitoring", "resolved"]);
const VALID_EVENT_KINDS = new Set([
  "alert",
  "deployment",
  "restart",
  "backup",
  "configuration",
  "monitor",
  "note",
]);

export async function GET(request: Request) {
  return withAdmin(request, async (admin) => {
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get("limit");
    let limit = 100;
    if (rawLimit !== null && rawLimit !== "") {
      limit = Number.parseInt(rawLimit, 10);
      if (!Number.isFinite(limit) || limit < 1) limit = 100;
    }
    limit = Math.min(limit, 500);

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

    return apiData({
      items: result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        severity: row.severity,
        status: row.status,
        services: row.services ?? [],
        started_at: row.started_at.toISOString(),
        ...(row.resolved_at ? { resolved_at: row.resolved_at.toISOString() } : {}),
        ...(row.created_by_account_id ? { created_by_account_id: row.created_by_account_id } : {}),
        events: (row.events ?? []).map((event) => ({
          id: event.id,
          incident_id: event.incident_id,
          kind: event.kind,
          message: event.message,
          ...(event.actor_account_id ? { actor_account_id: event.actor_account_id } : {}),
          created_at: event.created_at.toISOString(),
        })),
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
        // Unused by the UI but kept for parity with the Forge payload.
        admin_email: admin.email,
      })),
    });
  });
}

export async function POST(request: Request) {
  return withAdmin(request, async (admin) => {
    const body = (await request.json().catch(() => null)) as {
      title?: string;
      severity?: string;
      status?: string;
      services?: string[];
      message?: string;
    } | null;

    if (!body || typeof body.title !== "string" || body.title.trim() === "") {
      throw new ApiError(422, "validation_error", "title is required.");
    }
    if (!VALID_SEVERITIES.has(body.severity ?? "")) {
      throw new ApiError(422, "validation_error", "severity is invalid.");
    }
    const status = body.status ?? "investigating";
    if (!VALID_STATUSES.has(status)) {
      throw new ApiError(422, "validation_error", "status is invalid.");
    }
    if (!Array.isArray(body.services)) {
      throw new ApiError(422, "validation_error", "services is required.");
    }

    const incidentId = randomUUID();
    const now = new Date();

    await pool.query(
      `INSERT INTO "admin_incident"
         ("id", "title", "severity", "status", "services", "startedAt",
          "resolvedAt", "createdByAccountId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $6, $6)`,
      [
        incidentId,
        body.title.trim(),
        body.severity,
        status,
        JSON.stringify(body.services),
        now,
        status === "resolved" ? now : null,
        admin.userId,
      ],
    );

    // A new incident records its opening note the same way Forge does.
    if (body.message && body.message.trim() !== "") {
      await pool.query(
        `INSERT INTO "admin_incident_event"
           ("id", "incidentId", "kind", "message", "actorAccountId", "createdAt")
         VALUES ($1, $2, 'note', $3, $4, $5)`,
        [randomUUID(), incidentId, body.message.trim(), admin.userId, now],
      );
    }

    return apiData({ incident: { id: incidentId } }, 201);
  });
}

export async function PUT(request: Request) {
  return withAdmin(request, async (admin) => {
    const body = (await request.json().catch(() => null)) as {
      incident_id?: string;
      status?: string;
      event?: { kind?: string; message?: string };
    } | null;

    if (!body || typeof body.incident_id !== "string") {
      throw new ApiError(422, "validation_error", "incident_id is required.");
    }

    if (body.status !== undefined) {
      if (!VALID_STATUSES.has(body.status)) {
        throw new ApiError(422, "validation_error", "status is invalid.");
      }
      const result = await pool.query(
        `UPDATE "admin_incident"
         SET "status" = $1,
             "resolvedAt" = CASE WHEN $1 = 'resolved' THEN now() ELSE "resolvedAt" END,
             "updatedAt" = now()
         WHERE "id" = $2`,
        [body.status, body.incident_id],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ApiError(404, "not_found", "Incident not found.");
      }
    }

    if (body.event) {
      const kind = body.event.kind ?? "note";
      if (!VALID_EVENT_KINDS.has(kind)) {
        throw new ApiError(422, "validation_error", "event kind is invalid.");
      }
      if (typeof body.event.message !== "string" || body.event.message.trim() === "") {
        throw new ApiError(422, "validation_error", "event message is required.");
      }
      await pool.query(
        `INSERT INTO "admin_incident_event"
           ("id", "incidentId", "kind", "message", "actorAccountId", "createdAt")
         VALUES ($1, $2, $3, $4, $5, now())`,
        [randomUUID(), body.incident_id, kind, body.event.message.slice(0, 2000), admin.userId],
      );
    }

    return apiData({ incident: { id: body.incident_id } });
  });
}
