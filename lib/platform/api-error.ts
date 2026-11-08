/**
 * Control Plane JSON API error. Lives in its own module so the deployment worker
 * can import it without pulling in the Next.js auth stack, and avoids TypeScript
 * parameter properties because the worker runs through Node's type stripping.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
