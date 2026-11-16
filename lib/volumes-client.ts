export type VolumeSummary = {
  id: string;
  serviceId: string;
  mountPath: string;
  sizeMb: number;
  /** Measured by the Node Agent; null when the node could not be asked. */
  usageMb: number | null;
  /** False until the first Deployment created the Docker Volume. */
  exists: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ServiceVolume = {
  volume: VolumeSummary | null;
  needsRedeploy: boolean;
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

function volumePath(serviceId: string): string {
  return `/api/services/${encodeURIComponent(serviceId)}/volume`;
}

export function getServiceVolume(serviceId: string): Promise<ServiceVolume> {
  return request<ServiceVolume>(volumePath(serviceId));
}

export type CreateVolumeInput = {
  mountPath: string;
  sizeMb?: number;
};

export function createServiceVolume(
  serviceId: string,
  input: CreateVolumeInput,
): Promise<VolumeSummary> {
  return request<VolumeSummary>(volumePath(serviceId), { method: "POST", body: input });
}

export function deleteServiceVolume(serviceId: string): Promise<{ id: string }> {
  return request<{ id: string }>(volumePath(serviceId), { method: "DELETE" });
}
