import { pool } from "@/lib/platform/db";
import { apiData, withAdmin } from "@/lib/platform/api";
import { OAUTH_PROVIDERS, storedOAuthProviders } from "@/lib/platform/oauth-providers";

/**
 * Admin OAuth providers — mirrors stealth-forge's `/v1/admin/oauth-providers`.
 * paas signs users in through Better Auth with GitHub and Google: credentials
 * the Platform Admin stored live in `oauth_provider_config` and win over the
 * process environment. Secrets are write-only and are never returned; the
 * panel shows the client ID, the callback URL, and where the configuration
 * lives. Stored credentials apply on the next control-plane restart.
 */

type ProviderStatus = {
  provider: string;
  configured: boolean;
  callback_url: string;
  source: "database" | "environment" | "none";
  updated_at?: string;
};

function callbackUrl(provider: string): string {
  const baseURL =
    process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${baseURL.replace(/\/$/, "")}/api/auth/callback/${provider}`;
}

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const [stored, updatedAt] = await Promise.all([storedOAuthProviders(), updateTimestamps()]);

    const providers: ProviderStatus[] = OAUTH_PROVIDERS.map((provider) => {
      const storedCredential = stored[provider];
      const envClientId =
        provider === "github"
          ? (process.env.GITHUB_CLIENT_ID ?? process.env.BETTER_AUTH_GITHUB_CLIENT_ID)
          : (process.env.GOOGLE_CLIENT_ID ?? process.env.BETTER_AUTH_GOOGLE_CLIENT_ID);

      return {
        provider,
        configured: Boolean(storedCredential) || Boolean(envClientId),
        client_id: storedCredential ? storedCredential.clientId : (envClientId ?? undefined),
        callback_url: callbackUrl(provider),
        source: storedCredential
          ? ("database" as const)
          : envClientId
            ? ("environment" as const)
            : ("none" as const),
        updated_at: updatedAt[provider],
      };
    });

    return apiData({ providers });
  });
}

/** Per-provider update timestamps for the panel's saved-when line. */
async function updateTimestamps(): Promise<Record<string, string | undefined>> {
  const result = await pool.query<{ provider: string; updated_at: string }>(
    `SELECT "provider", "updatedAt" AS "updated_at" FROM "oauth_provider_config"`,
  );
  const map: Record<string, string | undefined> = {};
  for (const row of result.rows) map[row.provider] = row.updated_at;
  return map;
}
