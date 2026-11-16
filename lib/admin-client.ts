import { request } from "@/lib/platform/http";

export type ScanScanner = "trivy" | "clamav";
export type ScanSeverity = "critical" | "high" | "medium" | "low" | "info" | "unknown";

export type ScanFindingSummary = {
  id: string;
  deploymentId: string;
  scanner: ScanScanner;
  severity: ScanSeverity;
  title: string;
  details: Record<string, unknown>;
  urgent: boolean;
  createdAt: string;
  organizationId: string;
  organizationName: string;
  projectId: string;
  projectName: string;
  serviceId: string;
  serviceName: string;
  commitSha: string | null;
  imageRef: string | null;
};

export type ScanFindingList = {
  findings: ScanFindingSummary[];
  urgent: number;
  total: number;
};

/** Whether the signed-in user is a Platform Admin, for the sidebar link. */
export function getAdminStatus(): Promise<{ platformAdmin: boolean }> {
  return request<{ platformAdmin: boolean }>("/api/admin/status");
}

/** Lists ScanFindings across every Organization. Admins only. */
export function getScanFindings(options: { urgentOnly?: boolean } = {}): Promise<ScanFindingList> {
  const query = options.urgentOnly ? "?urgent=true" : "";
  return request<ScanFindingList>(`/api/admin/findings${query}`);
}

/** One host sample of a node's own CPU, memory, and storage usage. */
export type HostMetricSample = {
  capturedAt: string;
  cpuPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  storageUsedMb: number;
  storageTotalMb: number;
};

export type HostMetricNode = {
  id: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  current: HostMetricSample | null;
  history: HostMetricSample[];
};

export type HostMetricReport = {
  nodes: HostMetricNode[];
};

/** Reads every node's host metrics. Admins only. */
export function getHostMetrics(windowMinutes?: number): Promise<HostMetricReport> {
  const query = windowMinutes ? `?window_minutes=${windowMinutes}` : "";
  return request<HostMetricReport>(`/api/admin/host-metrics${query}`);
}

/** Component health row of the admin overview. */
export type AdminComponentStatus = {
  component: string;
  status: "ok" | "degraded" | "down";
  detail: string | null;
};

export type AdminRecentDeployment = {
  id: string;
  status: string;
  commitSha: string | null;
  createdAt: string;
  finishedAt: string | null;
  serviceName: string;
  projectName: string;
  organizationName: string;
};

export type AdminOverview = {
  checkedAt: string;
  components: AdminComponentStatus[];
  counts: {
    users: number;
    organizations: number;
    projects: number;
    services: number;
    deploymentsRunning: number;
    jobsQueued: number;
    jobsRunning: number;
    jobsFailed: number;
  };
  recentDeployments: AdminRecentDeployment[];
};

/** Reads the whole overview payload. Admins only. */
export function getAdminOverview(): Promise<AdminOverview> {
  return request<AdminOverview>("/api/admin/overview");
}

export type AdminAccount = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  username: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  organizations: number;
};

export type AdminAccountList = {
  items: AdminAccount[];
  total: number;
};

/** Reads every account in the directory. Admins only. */
export function getAdminAccounts(): Promise<AdminAccountList> {
  return request<AdminAccountList>("/api/admin/accounts");
}
