export type ServiceStatus =
  "not_deployed" | "deploying" | "running" | "stopped" | "failed" | "suspended";

export type ServiceSummary = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  repoUrl: string;
  branch: string;
  dockerfilePath: string;
  containerPort: number;
  healthPath: string | null;
  status: ServiceStatus;
  platformHostname: string;
  url: string;
  cpuLimit: number;
  memoryLimitMb: number;
  /** True when Environment Variable changes are not live yet. */
  needsRedeploy: boolean;
  createdAt: string;
  updatedAt: string;
};

type ApiFailure = {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
};

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const payload = (await response.json().catch(() => ({}))) as { data?: T } & ApiFailure;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The request could not be completed.");
  }

  return payload.data as T;
}

export type CreateServiceInput = {
  name: string;
  repoUrl: string;
  branch?: string;
  dockerfilePath?: string;
  containerPort?: number;
  healthPath?: string;
};

export function listServices(projectId: string): Promise<ServiceSummary[]> {
  return request<ServiceSummary[]>(`/api/projects/${encodeURIComponent(projectId)}/services`);
}

export type OrganizationService = ServiceSummary & { projectName: string };

export function listOrganizationServices(): Promise<OrganizationService[]> {
  return request<OrganizationService[]>("/api/services");
}

export function getService(serviceId: string): Promise<ServiceSummary> {
  return request<ServiceSummary>(`/api/services/${encodeURIComponent(serviceId)}`);
}

export function createService(
  projectId: string,
  input: CreateServiceInput,
): Promise<ServiceSummary> {
  return request<ServiceSummary>(`/api/projects/${encodeURIComponent(projectId)}/services`, {
    method: "POST",
    body: input,
  });
}

export function deleteService(serviceId: string, confirmation: string): Promise<{ id: string }> {
  return request<{ id: string }>(`/api/services/${encodeURIComponent(serviceId)}`, {
    method: "DELETE",
    body: { confirmation },
  });
}

const STATUS_LABELS: Record<ServiceStatus, string> = {
  not_deployed: "Not deployed",
  deploying: "Deploying",
  running: "Running",
  stopped: "Stopped",
  failed: "Failed",
  suspended: "Suspended",
};

export function serviceStatusLabel(status: ServiceStatus): string {
  return STATUS_LABELS[status] ?? status;
}
