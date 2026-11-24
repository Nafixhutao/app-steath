import { pool } from "./db.ts";
import { decryptSecret, encryptSecret } from "./secrets.ts";

/**
 * Stored credentials for the external sign-in providers (GitHub, Google).
 * The Platform Admin saves them in the Settings panel; the secret is
 * encrypted at rest and never exposed through the API. The auth context
 * reads the store once at process start, so an admin change applies on the
 * next control-plane restart.
 */

export const OAUTH_PROVIDERS = ["github", "google"] as const;

export type OAuthProviderName = (typeof OAUTH_PROVIDERS)[number];

export type OAuthProviderCredential = {
  clientId: string;
  clientSecret: string;
};

export function isOAuthProviderName(value: string): value is OAuthProviderName {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/** Every stored provider, decrypted for in-process use (never serialized). */
export async function storedOAuthProviders(): Promise<
  Partial<Record<OAuthProviderName, OAuthProviderCredential>>
> {
  const result = await pool.query<{
    provider: string;
    client_id: string;
    client_secret: string;
  }>(
    `SELECT "provider", "clientId" AS "client_id", "clientSecret" AS "client_secret"
     FROM "oauth_provider_config"`,
  );

  const stored: Partial<Record<OAuthProviderName, OAuthProviderCredential>> = {};
  for (const row of result.rows) {
    if (!isOAuthProviderName(row.provider)) continue;
    try {
      stored[row.provider] = {
        clientId: row.client_id,
        clientSecret: decryptSecret(row.client_secret),
      };
    } catch {
      // A row that cannot be decrypted (key rotated away) is skipped rather
      // than breaking sign-in entirely; the process log is where the admin
      // sees it.
      console.warn(`[oauth-providers] cannot decrypt secret for ${row.provider}; skipping`);
    }
  }
  return stored;
}

/** One provider's stored credential, or null when it is not configured. */
export async function storedOAuthProvider(
  provider: OAuthProviderName,
): Promise<OAuthProviderCredential | null> {
  const result = await pool.query<{ client_id: string; client_secret: string }>(
    `SELECT "clientId" AS "client_id", "clientSecret" AS "client_secret"
     FROM "oauth_provider_config" WHERE "provider" = $1`,
    [provider],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { clientId: row.client_id, clientSecret: decryptSecret(row.client_secret) };
}

/** Upserts one provider's credentials; the secret is encrypted before insert. */
export async function upsertOAuthProvider(
  provider: OAuthProviderName,
  credential: OAuthProviderCredential,
): Promise<void> {
  await pool.query(
    `INSERT INTO "oauth_provider_config" ("provider", "clientId", "clientSecret", "updatedAt")
     VALUES ($1, $2, $3, now())
     ON CONFLICT ("provider") DO UPDATE
       SET "clientId" = EXCLUDED."clientId",
           "clientSecret" = EXCLUDED."clientSecret",
           "updatedAt" = now()`,
    [provider, credential.clientId, encryptSecret(credential.clientSecret)],
  );
}

/** Removes one provider's stored credentials; sign-in falls back to env. */
export async function deleteOAuthProvider(provider: OAuthProviderName): Promise<void> {
  await pool.query(`DELETE FROM "oauth_provider_config" WHERE "provider" = $1`, [provider]);
}

/**
 * The better-auth `socialProviders` entry style: an async factory the auth
 * context awaits at boot. Returns null for an unconfigured provider so the
 * endpoint honestly answers "Provider not found" instead of failing mid-flow.
 */
export async function socialProviderConfig(
  provider: OAuthProviderName,
): Promise<{ clientId: string; clientSecret: string } | null> {
  const stored = await storedOAuthProvider(provider);
  if (stored) return stored;

  // Admin-saved credentials win, but deployments that configure providers via
  // environment variables must work too: the sign-in page advertises them.
  const prefix = provider === "github" ? "GITHUB" : "GOOGLE";
  const clientId =
    process.env[`${prefix}_CLIENT_ID`] ?? process.env[`BETTER_AUTH_${prefix}_CLIENT_ID`];
  const clientSecret =
    process.env[`${prefix}_CLIENT_SECRET`] ?? process.env[`BETTER_AUTH_${prefix}_CLIENT_SECRET`];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
