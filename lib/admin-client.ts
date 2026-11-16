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

type ApiFailure = {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
};

async function parse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { data?: T } & ApiFailure;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The request could not be completed.");
  }

  return payload.data as T;
}

/** Whether the signed-in user is a Platform Admin, for the sidebar link. */
export async function getAdminStatus(): Promise<{ platformAdmin: boolean }> {
  const response = await fetch("/api/admin/status");

  return parse<{ platformAdmin: boolean }>(response);
}

/** Lists ScanFindings across every Organization. Admins only. */
export async function getScanFindings(
  options: { urgentOnly?: boolean } = {},
): Promise<ScanFindingList> {
  const query = options.urgentOnly ? "?urgent=true" : "";
  const response = await fetch(`/api/admin/findings${query}`);

  return parse<ScanFindingList>(response);
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
export async function getHostMetrics(windowMinutes?: number): Promise<HostMetricReport> {
  const query = windowMinutes ? `?window_minutes=${windowMinutes}` : "";
  const response = await fetch(`/api/admin/host-metrics${query}`);

  return parse<HostMetricReport>(response);
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
export async function getAdminOverview(): Promise<AdminOverview> {
  const response = await fetch("/api/admin/overview");

  return parse<AdminOverview>(response);
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
export async function getAdminAccounts(): Promise<AdminAccountList> {
  const response = await fetch("/api/admin/accounts");

  return parse<AdminAccountList>(response);
}
