import { apiData, withAdmin } from "@/lib/platform/api";
import { listEmailProviders } from "@/lib/platform/email-settings";

/** Lists both email providers with masked credentials and local quota usage. */
export async function GET(request: Request) {
  return withAdmin(request, async () => apiData(await listEmailProviders()));
}
