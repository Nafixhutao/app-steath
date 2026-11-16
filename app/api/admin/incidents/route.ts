import { ApiError, apiData, withAdmin } from "@/lib/platform/api";
import {
  addIncidentEvent,
  createIncident,
  IncidentNotFound,
  listIncidents,
  updateIncidentStatus,
  VALID_EVENT_KINDS,
  VALID_SEVERITIES,
  VALID_STATUSES,
} from "@/lib/platform/admin-work-queries";

/**
 * Admin incidents — mirrors stealth-forge's `/v1/admin/incidents` board: the
 * incident list with each incident's event history, creation, and status
 * transitions. paas stores incidents in its own tables (this is the one Forge
 * surface that needed a new backend), and the wire shapes match the Forge
 * OpenAPI exactly so the ported components render unmodified.
 */

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

    return apiData(await listIncidents(limit, admin.email));
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

    const incident = await createIncident({
      title: body.title.trim(),
      severity: body.severity as string,
      status,
      services: body.services,
      message: body.message,
      createdByAccountId: admin.userId,
    });

    return apiData({ incident: { id: incident.id } }, 201);
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
      try {
        await updateIncidentStatus(body.incident_id, body.status);
      } catch (error) {
        if (!(error instanceof IncidentNotFound)) throw error;
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
      await addIncidentEvent({
        incidentId: body.incident_id,
        kind,
        message: body.event.message.slice(0, 2000),
        actorAccountId: admin.userId,
      });
    }

    return apiData({ incident: { id: body.incident_id } });
  });
}
