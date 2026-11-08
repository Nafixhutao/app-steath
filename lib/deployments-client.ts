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

export type ServiceRuntimeState = {
  serviceId: string;
  status: "running" | "stopped" | "absent";
  containerId: string | null;
  deploymentId: string | null;
  hostname: string | null;
};

export type ServiceRuntimeAction = "stop" | "start" | "restart";

/** Reads whether the Service container is running, stopped, or absent. */
export function getServiceRuntime(serviceId: string): Promise<ServiceRuntimeState> {
  return request<ServiceRuntimeState>(`/api/services/${encodeURIComponent(serviceId)}/runtime`);
}

/** Runs a lifecycle action against the Service container. */
export function runServiceAction(
  serviceId: string,
  action: ServiceRuntimeAction,
): Promise<ServiceRuntimeState> {
  return request<ServiceRuntimeState>(
    `/api/services/${encodeURIComponent(serviceId)}/${action}`,
    { method: "POST" },
  );
}

/**
 * Follows the Service's runtime log. The caller aborts the signal when the log
 * panel closes, which also stops the Node Agent from streaming.
 */
export async function streamRuntimeLog(
  serviceId: string,
  tail: number,
  onLine: (line: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `/api/services/${encodeURIComponent(serviceId)}/logs?tail=${tail}`,
    { signal },
  );

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(payload.error?.message ?? "The runtime log could not be read.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const event = JSON.parse(line) as { message?: string };
        if (typeof event.message === "string") {
          onLine(event.message);
        }
      }
      newline = buffer.indexOf("\n");
    }
  }
}

export function serviceRuntimeLabel(status: ServiceRuntimeState["status"]): string {
  switch (status) {
    case "running":
      return "Running";
    case "stopped":
      return "Stopped";
    default:
      return "Not deployed";
  }
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
