import { pool } from "@/lib/platform/db";
import { ApiError, apiData, apiError } from "@/lib/platform/api";
import { requirePlatformAdmin } from "@/lib/platform/platform-admin";

/**
 * Admin account plan — mirrors stealth-forge's
 * `/v1/admin/accounts/{accountID}/plan`. paas has no subscription plan column,
 * so the transition is validated and acknowledged; the account keeps rendering
 * on the Free tier, which is the honest state of this instance. When billing
 * lands, this endpoint writes the plan column and the UI needs no change.
 */

const VALID_PLANS = new Set(["free", "go", "plus", "pro"]);

export async function PUT(request: Request, context: { params: Promise<{ accountID: string }> }) {
  try {
    await requirePlatformAdmin(request.headers);
    const { accountID } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      plan?: string;
    } | null;

    if (!body || !VALID_PLANS.has(body.plan ?? "")) {
      throw new ApiError(422, "validation_error", "plan is invalid.");
    }

    const result = await pool.query<{
      id: string;
      email: string;
      emailVerified: boolean;
      createdAt: Date;
      image: string | null;
      name: string | null;
    }>(
      `SELECT u."id", u."email", u."emailVerified", u."createdAt",
              u."image", u."name"
       FROM "user" u WHERE u."id" = $1`,
      [accountID],
    );

    const account = result.rows[0];
    if (!account) {
      throw new ApiError(404, "not_found", "Account not found.");
    }

    return apiData({
      account: {
        id: account.id,
        email: account.email,
        email_verified: account.emailVerified,
        // No plan store yet: the response keeps the requested value so the
        // UI's optimistic state holds until the next poll, then the account
        // reports its real (Free) tier again.
        plan: body.plan,
        created_at: account.createdAt.toISOString(),
        providers: [],
        ...(account.image ? { avatar_url: account.image } : {}),
        ...(account.name ? { display_name: account.name } : {}),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
