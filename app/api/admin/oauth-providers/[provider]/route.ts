import { ApiError, withAdmin } from "@/lib/platform/api";

/**
 * Admin one OAuth provider — mirrors stealth-forge's
 * `/v1/admin/oauth-providers/{provider}`. paas has no credential store yet, so
 * both writes answer 503 with the same message the panel renders.
 */

const VALID = new Set(["github", "google"]);

export async function PUT(request: Request, context: RouteContext<'/api/admin/oauth-providers/[provider]'>) {
  return withAdmin(request, async () => {
    const { provider } = await context.params;
    if (!VALID.has(provider)) {
      throw new ApiError(422, "validation_error", "provider is invalid.");
    }
    throw new ApiError(
      503,
      "not_configured",
      "Storing provider credentials is not configured on this instance yet.",
    );
  });
}

export async function DELETE(request: Request, context: RouteContext<'/api/admin/oauth-providers/[provider]'>) {
  return withAdmin(request, async () => {
    const { provider } = await context.params;
    if (!VALID.has(provider)) {
      throw new ApiError(422, "validation_error", "provider is invalid.");
    }
    throw new ApiError(
      503,
      "not_configured",
      "Storing provider credentials is not configured on this instance yet.",
    );
  });
}
