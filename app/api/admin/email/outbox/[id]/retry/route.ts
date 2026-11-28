import { apiData, withAdmin } from "@/lib/platform/api";
import { recordPlatformAudit } from "@/lib/platform/audit";
import { retryEmail } from "@/lib/platform/mailer";

/** Requeues a failed message. The worker picks it up on its next pass. */
export async function POST(
  request: Request,
  context: RouteContext<"/api/admin/email/outbox/[id]/retry">,
) {
  return withAdmin(request, async (actor) => {
    const { id } = await context.params;
    await retryEmail(id);
    await recordPlatformAudit("platform.email.outbox_retried", actor.userId, { emailId: id });
    return apiData({ id });
  });
}
