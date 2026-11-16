import { ApiError, apiData, withAdmin } from "@/lib/platform/api";
import { getAccountForPlan } from "@/lib/platform/admin-work-queries";

/**
 * Admin account plan — mirrors stealth-forge's
 * `/v1/admin/accounts/{accountID}/plan`. paas has no subscription plan column,
 * so the transition is validated and acknowledged; the account keeps rendering
 * on the Free tier, which is the honest state of this instance. When billing
 * lands, this endpoint writes the plan column and the UI needs no change.
 */

const VALID_PLANS = new Set(["free", "go", "plus", "pro"]);

export async function PUT(
  request: Request,
  context: RouteContext<"/api/admin/accounts/[accountID]/plan">,
) {
  return withAdmin(request, async () => {
    const { accountID } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      plan?: string;
    } | null;

    if (!body || !VALID_PLANS.has(body.plan ?? "")) {
      throw new ApiError(422, "validation_error", "plan is invalid.");
    }

    const account = await getAccountForPlan(accountID);
    if (!account) {
      throw new ApiError(404, "not_found", "Account not found.");
    }

    return apiData({
      account: {
        ...account,
        // No plan store yet: the response keeps the requested value so the
        // UI's optimistic state holds until the next poll, then the account
        // reports its real (Free) tier again.
        plan: body.plan,
      },
    });
  });
}
