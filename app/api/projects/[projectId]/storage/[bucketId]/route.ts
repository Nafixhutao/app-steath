import { apiData, readJson, withOrg } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { deleteProjectStorageBucket } from "@/lib/platform/storage";

/**
 * Deletes a Bucket and everything in it. The caller must type the Bucket name,
 * because the Node Agent removes the objects before the row is deleted.
 */
export async function DELETE(
  request: Request,
  context: RouteContext<"/api/projects/[projectId]/storage/[bucketId]">,
) {
  return withOrg(request, ["owner", "admin"], async (actor) => {
    const input = await readJson<{ confirmation?: unknown }>(request);
    const { projectId, bucketId } = await context.params;
    const deleted = await deleteProjectStorageBucket({
      organizationId: actor.organizationId,
      projectId,
      bucketId,
      confirmation: input.confirmation,
    });

    await recordAudit("storage.bucket_deleted", actor.organizationId, actor.userId, undefined, {
      projectId,
      bucketId,
      name: deleted.name,
    });

    return apiData({ id: deleted.id });
  });
}
