import { ApiError } from "@/lib/platform/api-error";
import {
  OrganizationAccessError,
  type ActiveOrganizationContext,
} from "@/lib/platform/organization";
import { requireOrganizationRole } from "@/lib/platform/organization-management";
import { requirePlatformAdmin, type PlatformAdminContext } from "@/lib/platform/platform-admin";

/**
 * Control Plane JSON API envelope. Successful responses carry `{ data }` and
 * failures carry `{ error: { code, message, details? } }`, as defined in the
 * platform spec, so every resource endpoint behaves the same way.
 */
export { ApiError };

export function apiData(data: unknown, status = 200): Response {
  return Response.json({ data }, { status });
}

export function apiError(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }

  if (error instanceof OrganizationAccessError) {
    return Response.json(
      {
        error: {
          code: error.status === 401 ? "unauthenticated" : "forbidden",
          message: error.message,
        },
      },
      { status: error.status },
    );
  }

  console.error("API request failed", error);
  return Response.json(
    { error: { code: "internal_error", message: "The request could not be completed." } },
    { status: 500 },
  );
}

/**
 * Parses the request body as JSON, answering 400 invalid_body when it is
 * missing or malformed. Every route that requires a JSON body starts here, so
 * a broken body can never surface as a 500.
 */
export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError(400, "invalid_body", "Invalid request body.");
  }
}

/**
 * Wraps a route handler in the shared error envelope: anything the handler
 * throws is answered by `apiError`, so a route can never forget the epilog.
 */
export function withErrors(handler: () => Promise<Response>): Promise<Response> {
  return handler().catch(apiError);
}

type OrgHandler = (actor: ActiveOrganizationContext) => Promise<Response>;

/**
 * Resolves the caller's Organization membership with one of the allowed roles,
 * then hands the actor to the handler. A failure anywhere — authentication,
 * role, handler — is answered by the shared envelope.
 */
export function withOrg(request: Request, roles: string[], handler: OrgHandler): Promise<Response> {
  return withErrors(async () => {
    const actor = await requireOrganizationRole(request.headers, roles);
    return handler(actor);
  });
}

type AdminHandler = (actor: PlatformAdminContext) => Promise<Response>;

/**
 * Same seam for Platform Admin endpoints: the session is resolved and checked
 * against the platform admin allowlist before the handler runs.
 */
export function withAdmin(request: Request, handler: AdminHandler): Promise<Response> {
  return withErrors(async () => {
    const actor = await requirePlatformAdmin(request.headers);
    return handler(actor);
  });
}
