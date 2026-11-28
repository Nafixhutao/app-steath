import { ApiError } from "@/lib/platform/api-error";
import { apiData, readJson, withAdmin } from "@/lib/platform/api";
import { recordPlatformAudit } from "@/lib/platform/audit";
import { sendTestEmail } from "@/lib/platform/mailer";
import type { MailProviderId } from "@/lib/platform/email-settings";

/** Sends a test email through one specific provider, enabled or not. */
export async function POST(request: Request) {
  return withAdmin(request, async (actor) => {
    const body = await readJson<{ to?: unknown; provider?: unknown }>(request);
    if (body.provider !== "resend" && body.provider !== "mailjet") {
      throw new ApiError(400, "invalid_provider", "Choose Resend or Mailjet.");
    }

    const result = await sendTestEmail({
      to: String(body.to ?? "").trim(),
      provider: body.provider as MailProviderId,
    });
    await recordPlatformAudit("platform.email.test_sent", actor.userId, {
      provider: result.provider,
      to: body.to,
    });
    return apiData(result);
  });
}
