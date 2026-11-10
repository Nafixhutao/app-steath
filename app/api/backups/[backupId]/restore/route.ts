import { ApiError, apiData, apiError } from "@/lib/platform/api";
import { requireOrganizationRole } from "@/lib/platform/organization-management";
import { createRestore } from "@/lib/platform/restores";

type RouteContext = { params: Promise<{ backupId: string }> };

/**
 * Queues a Restore of one completed Database or Volume Backup. Owners and admins
 * may restore: it stops the affected Services, so it is a configuration change
 * rather than a read. The body must carry the typed confirmation.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireOrganizationRole(request.headers, ["owner", "admin"]);
    const { backupId } = await context.params;

    const body = (await request.json().catch(() => ({}))) as {
      confirmation?: unknown;
    };
    if (typeof body.confirmation !== "string") {
      throw new ApiError(
        400,
        "confirmation_required",
        "Type the target name to confirm the Restore.",
      );
    }

    const restore = await createRestore({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      backupId,
      confirmation: body.confirmation,
    });

    return apiData(restore, 202);
  } catch (error) {
    return apiError(error);
  }
}
