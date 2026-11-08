import { ApiError } from "@/lib/platform/api-error";
import { TenantAccessError } from "@/lib/platform/tenant";

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

  if (error instanceof TenantAccessError) {
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
