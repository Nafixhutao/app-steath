/**
 * The one HTTP transport for the console's own JSON API. Every resource client
 * (projects, services, deployments, databases, backups, volumes, environment
 * variables, custom domains, usage, admin) is a thin binding over `request`.
 *
 * The API answers one envelope everywhere: `{ "data": ... }` on success and
 * `{ "error": { "code", "message", ... } }` on failure. Decoding that envelope
 * and flattening failures into the message panels render used to live in a
 * dozen copies; it lives here once now.
 */

type ApiEnvelopeFailure = {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
};

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RequestOptions = {
  method?: HttpMethod;
  /** Serialized as the JSON request body. */
  body?: unknown;
  /** Passed through to fetch; the admin panels pin `no-store`. */
  cache?: RequestCache;
};

/** Flattens any thrown value to the message a panel renders. */
export function transportError(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

/**
 * Performs one request against the console API and unwraps its envelope.
 * A non-2xx answer throws the API's own message, so callers render what the
 * server meant instead of a generic failure.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, cache } = options;

  const response = await fetch(path, {
    method,
    cache,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as { data?: T } & ApiEnvelopeFailure;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The request could not be completed.");
  }

  return payload.data as T;
}
