import { apiData, withOrg } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { revealProjectStorageBucketSecret } from "@/lib/platform/storage";

/**
 * Reveals a Bucket's Secret Key on demand, only for owners and admins. The
 * audit event records that a reveal happened, never the value itself.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/projects/[projectId]/storage/[bucketId]/secret">,
) {
  return withOrg(request, ["owner", "admin"], async (actor) => {
    const { projectId, bucketId } = await context.params;
    const secret = await revealProjectStorageBucketSecret({
      organizationId: actor.organizationId,
      projectId,
      bucketId,
    });

    await recordAudit("storage.secret_revealed", actor.organizationId, actor.userId, undefined, {
      projectId,
      bucketId,
    });

    return apiData(secret);
  });
}
