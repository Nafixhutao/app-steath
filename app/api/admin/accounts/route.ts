import { pool } from "@/lib/platform/db";
import { apiData, apiError } from "@/lib/platform/api";
import { requirePlatformAdmin } from "@/lib/platform/platform-admin";

/**
 * Admin account directory — mirrors stealth-forge's `/v1/admin/accounts`
 * payload: every account with its verification state, plan, sign-in providers,
 * avatar, display name, and last sign-in, in the exact snake_case wire shape
 * the ported Users table renders.
 */
export async function GET(request: Request) {
  try {
    await requirePlatformAdmin(request.headers);

    const result = await pool.query<{
      id: string;
      email: string;
      email_verified: boolean;
      created_at: Date;
      avatar_url: string | null;
      display_name: string | null;
      last_sign_in_at: Date | null;
      last_sign_in_method: string | null;
      providers: string[];
    }>(`
      SELECT u."id",
             u."email",
             u."emailVerified" AS "email_verified",
             u."createdAt" AS "created_at",
             u."image" AS "avatar_url",
             u."name" AS "display_name",
             (SELECT max(s."createdAt") FROM "session" s
              WHERE s."userId" = u."id") AS "last_sign_in_at",
             -- The newest account row is the provider the account last used.
             (SELECT a."providerId" FROM "account" a
              WHERE a."userId" = u."id"
              ORDER BY a."createdAt" DESC LIMIT 1) AS "last_sign_in_method",
             COALESCE((
               SELECT jsonb_agg(DISTINCT a2."providerId")
               FROM "account" a2
               WHERE a2."userId" = u."id"
                 AND a2."providerId" IN ('github', 'google')
             ), '[]'::jsonb) AS providers
      FROM "user" u
      ORDER BY u."createdAt" DESC
      LIMIT 500
    `);

    return apiData({
      items: result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        email_verified: row.email_verified,
        // paas has no subscription plan column; every account renders on the
        // Free tier, which is the honest state of this instance.
        plan: "free",
        created_at: row.created_at.toISOString(),
        providers: row.providers ?? [],
        ...(row.avatar_url ? { avatar_url: row.avatar_url } : {}),
        ...(row.display_name ? { display_name: row.display_name } : {}),
        ...(row.last_sign_in_at ? { last_sign_in_at: row.last_sign_in_at.toISOString() } : {}),
        ...(row.last_sign_in_method ? { last_sign_in_method: row.last_sign_in_method } : {}),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
