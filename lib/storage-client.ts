import { request } from "@/lib/platform/http";

export type StorageBucketStatus = "provisioning" | "ready" | "failed";

/**
 * One S3-compatible Bucket in a Project. Buckets live on the platform's MinIO
 * cluster and are reached through the path-style S3 endpoint below.
 */
export type StorageBucketSummary = {
  id: string;
  projectId: string;
  name: string;
  /** The physical bucket name on the storage node. */
  objectName: string;
  public: boolean;
  status: StorageBucketStatus;
  quotaMb: number;
  /** Measured by the Node Agent; null when the node could not be asked. */
  usageMb: number | null;
  healthy: boolean;
  /** Hostname of the S3 endpoint, without a schema or bucket path. */
  endpoint: string;
  accessKey: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectStorage = { buckets: StorageBucketSummary[]; endpoint: string };

export function getProjectStorage(projectId: string): Promise<ProjectStorage> {
  return request<ProjectStorage>(`/api/projects/${encodeURIComponent(projectId)}/storage`);
}

export function createProjectStorageBucket(
  projectId: string,
  input: { name: string; public?: boolean; quotaMb?: number },
): Promise<StorageBucketSummary> {
  return request<StorageBucketSummary>(`/api/projects/${encodeURIComponent(projectId)}/storage`, {
    method: "POST",
    body: input,
  });
}

export function deleteProjectStorageBucket(
  projectId: string,
  bucketId: string,
  confirmation: string,
): Promise<{ id: string }> {
  return request<{ id: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/storage/${encodeURIComponent(bucketId)}`,
    {
      method: "DELETE",
      body: { confirmation },
    },
  );
}

/**
 * Reads the secret key on demand, for the Reveal button. It is fetched only when
 * the user asks, so the value is never part of the page payload the browser
 * caches or a log record. The API answers `{ accessKey, secretKey }`.
 */
export function revealProjectStorageBucketSecret(
  projectId: string,
  bucketId: string,
): Promise<{ accessKey: string; secretKey: string }> {
  return request<{ accessKey: string; secretKey: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/storage/${encodeURIComponent(bucketId)}/secret`,
  );
}
