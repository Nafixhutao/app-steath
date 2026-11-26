import { apiData, readJson, withAdmin } from "@/lib/platform/api";
import { recordPlatformAudit } from "@/lib/platform/audit";
import { updateEmailProvider } from "@/lib/platform/email-settings";

/** Updates one provider's credentials, sender, limits, and enabled state. */
export async function PUT(
  request: Request,
  context: RouteContext<"/api/admin/email/providers/[provider]">,
) {
  return withAdmin(request, async (actor) => {
    const { provider } = await context.params;
    const body = await readJson<{
      enabled?: unknown;
      priority?: unknown;
      apiKey?: unknown;
      apiSecret?: unknown;
      fromEmail?: unknown;
      fromName?: unknown;
      monthlyLimit?: unknown;
      dailyLimit?: unknown;
    }>(request);

    const updated = await updateEmailProvider({ provider, ...body });
    await recordPlatformAudit("platform.email.provider_updated", actor.userId, {
      provider,
      enabled: updated.enabled,
    });
    return apiData(updated);
  });
}
