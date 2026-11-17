import { ApiError } from "@/lib/platform/api-error";
import { apiData, readJson, withAdmin } from "@/lib/platform/api";
import {
  deleteOAuthProvider,
  isOAuthProviderName,
  upsertOAuthProvider,
  type OAuthProviderCredential,
} from "@/lib/platform/oauth-providers";

/**
 * Admin one OAuth provider — the credential store behind the Settings panel.
 * Secrets are write-only and never returned; the panel shows the client ID,
 * the callback URL, and where the configuration currently lives. Credentials
 * saved here are read by the auth context on the next control-plane restart.
 */

export async function PUT(
  request: Request,
  context: RouteContext<"/api/admin/oauth-providers/[provider]">,
) {
  return withAdmin(request, async () => {
    const { provider } = await context.params;
    if (!isOAuthProviderName(provider)) {
      throw new ApiError(422, "validation_error", "provider is invalid.");
    }

    const body = await readJson<{ client_id?: string; client_secret?: string }>(request);
    const clientId = body.client_id?.trim();
    const clientSecret = body.client_secret?.trim();
    if (!clientId || !clientSecret) {
      throw new ApiError(422, "validation_error", "client_id and client_secret are both required.");
    }

    const credential: OAuthProviderCredential = { clientId, clientSecret };
    await upsertOAuthProvider(provider, credential);
    return apiData({
      provider,
      configured: true,
      callback_url: callbackUrl(provider),
      source: "database",
    });
  });
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/admin/oauth-providers/[provider]">,
) {
  return withAdmin(request, async () => {
    const { provider } = await context.params;
    if (!isOAuthProviderName(provider)) {
      throw new ApiError(422, "validation_error", "provider is invalid.");
    }
    await deleteOAuthProvider(provider);
    return apiData({ provider, configured: false, source: "none" });
  });
}

function callbackUrl(provider: string): string {
  const baseURL =
    process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${baseURL.replace(/\/$/, "")}/api/auth/callback/${provider}`;
}
