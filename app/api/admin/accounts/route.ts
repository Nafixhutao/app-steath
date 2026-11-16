import { apiData, withAdmin } from "@/lib/platform/api";
import { listAdminAccounts } from "@/lib/platform/admin-read-queries";

/**
 * Admin account directory — mirrors stealth-forge's `/v1/admin/accounts`
 * payload: every account with its verification state, plan, sign-in providers,
 * avatar, display name, and last sign-in, in the exact snake_case wire shape
 * the ported Users table renders.
 */
export async function GET(request: Request) {
  return withAdmin(request, async () => {
    return apiData(await listAdminAccounts());
  });
}
