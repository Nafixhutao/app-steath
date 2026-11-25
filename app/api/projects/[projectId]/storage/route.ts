import { apiData, readJson, withOrg } from "@/lib/platform/api";
import { recordAudit } from "@/lib/platform/audit";
import { createProjectStorageBucket, getProjectStorageBuckets } from "@/lib/platform/storage";

/**
 * Lists the Project's S3 Buckets with the live state the Node Agent reports.
 * Secrets are never part of this payload: they are revealed on demand.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/projects/[projectId]/storage">,
) {
  return withOrg(request, ["owner", "admin", "member"], async (actor) => {
    const { projectId } = await context.params;
    return apiData(
      await getProjectStorageBuckets({ organizationId: actor.organizationId, projectId }),
    );
  });
}

/**
 * Creates a Bucket with its own Access Key, IAM policy, and hard storage quota.
 * The secret is generated server-side and sealed before it reaches the database.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/projects/[projectId]/storage">,
) {
  return withOrg(request, ["owner", "admin"], async (actor) => {
    const input = await readJson<{ name?: unknown; public?: unknown; quotaMb?: unknown }>(request);
    const { projectId } = await context.params;
    const created = await createProjectStorageBucket({
      organizationId: actor.organizationId,
      projectId,
      name: input.name,
      public: input.public,
      quotaMb: input.quotaMb,
    });

    await recordAudit("storage.bucket_created", actor.organizationId, actor.userId, undefined, {
      projectId,
      bucketId: created.id,
      name: created.name,
      public: created.public,
      quotaMb: created.quotaMb,
    });

    return apiData(created, 201);
  });
}
