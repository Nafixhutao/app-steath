export type DeploymentStatus =
  | "queued"
  | "building"
  | "deploying"
  | "running"
  | "failed"
  | "cancelled";

export type DeploymentSummary = {
  id: string;
  serviceId: string;
  status: DeploymentStatus;
  commitSha: string | null;
  imageRef: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type NodeSummary = {
  id: string;
  name: string;
  status: "unknown" | "healthy" | "unhealthy";
  lastSeenAt: string | null;
  capacity: {
    dockerVersion?: string;
    buildkitAvailable?: boolean;
    cpuCount?: number;
    memoryMb?: number;
  };
};

type ApiFailure = {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
};

async function request<T>(path: string, init: { method?: string } = {}): Promise<T> {
  const response = await fetch(path, { method: init.method ?? "GET" });
  const payload = (await response.json().catch(() => ({}))) as { data?: T } & ApiFailure;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The request could not be completed.");
  }

  return payload.data as T;
}

export function listDeployments(serviceId: string): Promise<DeploymentSummary[]> {
  return request<DeploymentSummary[]>(
    `/api/services/${encodeURIComponent(serviceId)}/deployments`,
  );
}

export function triggerDeployment(serviceId: string): Promise<DeploymentSummary> {
  return request<DeploymentSummary>(
    `/api/services/${encodeURIComponent(serviceId)}/deployments`,
    { method: "POST" },
  );
}

export type BuildLog = { deployment: DeploymentSummary; lines: string[] };

export function getBuildLog(deploymentId: string): Promise<BuildLog> {
  return request<BuildLog>(`/api/deployments/${encodeURIComponent(deploymentId)}/logs`);
}

export function listNodes(): Promise<NodeSummary[]> {
  return request<NodeSummary[]>("/api/nodes");
}

const STATUS_LABELS: Record<DeploymentStatus, string> = {
  queued: "Queued",
  building: "Building",
  deploying: "Deploying",
  running: "Running",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function deploymentStatusLabel(status: DeploymentStatus): string {
  return STATUS_LABELS[status] ?? status;
}

/** Deployment statuses that are still moving, so the UI keeps polling. */
export function isDeploymentActive(status: DeploymentStatus): boolean {
  return status === "queued" || status === "building" || status === "deploying";
}
