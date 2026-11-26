import { apiData, withAdmin } from "@/lib/platform/api";
import { listEmailOutbox } from "@/lib/platform/mailer";

/** Recent email deliveries, for the Admin Console's outbox monitor. */
export async function GET(request: Request) {
  return withAdmin(request, async () => apiData(await listEmailOutbox()));
}
