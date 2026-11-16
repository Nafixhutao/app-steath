import { request } from "@/lib/platform/http";

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
