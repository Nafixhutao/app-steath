export type QuotaCount = { used: number; limit: number };

export type UsageTotals = {
  cpu: number;
  memoryMb: number;
  volumeMb: number;
  databaseMb: number;
};

export type ServiceUsageSummary = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  status: string;
  cpuUsage: number;
  cpuLimit: number;
  memoryUsageMb: number;
  memoryLimitMb: number;
  volumeUsageMb: number;
  volumeLimitMb: number;
};

export type DatabaseUsageSummary = {
  id: string;
  projectId: string;
  projectName: string;
  status: string;
  usageMb: number;
  storageLimitMb: number;
  overQuota: boolean;
};

export type ProjectUsageSummary = {
  id: string;
  name: string;
  serviceCount: number;
  serviceLimit: number;
  databaseCount: number;
  databaseLimit: number;
};

export type OrganizationUsage = {
  capturedAt: string | null;
  limits: {
    projectsPerOrganization: number;
    servicesPerProject: number;
    servicesPerOrganization: number;
    databasesPerProject: number;
    cpuPerService: number;
    memoryMbPerService: number;
    volumeMbPerService: number;
    databaseStorageMb: number;
    buildConcurrencyPerNode: number;
    logRetentionDays: number;
  };
  counts: {
    projects: QuotaCount;
    services: QuotaCount;
    databases: { used: number };
  };
  totals: UsageTotals;
  projects: ProjectUsageSummary[];
  services: ServiceUsageSummary[];
  databases: DatabaseUsageSummary[];
};

type ApiFailure = {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
};

export async function getOrganizationUsage(): Promise<OrganizationUsage> {
  const response = await fetch("/api/usage");
  const payload = (await response.json().catch(() => ({}))) as {
    data?: OrganizationUsage;
  } & ApiFailure;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The request could not be completed.");
  }

  return payload.data as OrganizationUsage;
}
