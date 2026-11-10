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
