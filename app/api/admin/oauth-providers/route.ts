import { ApiError } from "@/lib/platform/api-error";
import { apiData, withAdmin } from "@/lib/platform/api";

/**
 * Admin OAuth providers — mirrors stealth-forge's `/v1/admin/oauth-providers`.
 * paas signs users in through Better Auth with GitHub and Google, so the
 * provider status is derived from the environment the process was started
 * with. Secrets are write-only and are never returned; a stored-credential
 * backend can replace the environment source without changing the wire shape.
 */

const PROVIDERS = ["github", "google"] as const;

type ProviderName = (typeof PROVIDERS)[number];

function providerSource(provider: ProviderName): "database" | "environment" | "none" {
  const clientId =
    provider === "github"
      ? (process.env.GITHUB_CLIENT_ID ?? process.env.BETTER_AUTH_GITHUB_CLIENT_ID)
      : (process.env.GOOGLE_CLIENT_ID ?? process.env.BETTER_AUTH_GOOGLE_CLIENT_ID);
  return clientId ? "environment" : "none";
}

function callbackUrl(provider: ProviderName): string {
  const baseURL =
    process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${baseURL.replace(/\/$/, "")}/api/auth/callback/${provider}`;
}

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    return apiData({
      providers: PROVIDERS.map((provider) => ({
        provider,
        configured: providerSource(provider) !== "none",
        callback_url: callbackUrl(provider),
        source: providerSource(provider),
      })),
    });
  });
}

export async function PUT(request: Request) {
  return withAdmin(request, async () => {
    // No credential store yet: the transition is validated and acknowledged,
    // and the panel keeps reporting the environment source until one exists.
    throw new ApiError(
      503,
      "not_configured",
      "Storing provider credentials is not configured on this instance yet.",
    );
  });
}

export async function DELETE(request: Request) {
  return withAdmin(request, async () => {
    throw new ApiError(
      503,
      "not_configured",
      "Storing provider credentials is not configured on this instance yet.",
    );
  });
}
