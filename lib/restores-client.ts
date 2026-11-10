export type RestoreTargetType = "database" | "volume";
export type RestoreStatus = "pending" | "running" | "completed" | "failed";

export type RestoreSummary = {
  id: string;
  backupId: string | null;
  targetType: RestoreTargetType;
  targetName: string;
  projectName: string | null;
  status: RestoreStatus;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type RestoreList = { restores: RestoreSummary[] };

type ApiFailure = {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
};

export async function getRestores(): Promise<RestoreList> {
  const response = await fetch("/api/restores");
  const payload = (await response.json().catch(() => ({}))) as {
    data?: RestoreList;
  } & ApiFailure;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The request could not be completed.");
  }

  return payload.data as RestoreList;
}

/**
 * Asks the Control Plane to restore one Backup. The confirmation is the target
 * name the user sees, so the request cannot be started by an accidental click.
 */
export async function requestRestore(
  backupId: string,
  confirmation: string,
): Promise<RestoreSummary> {
  const response = await fetch(`/api/backups/${encodeURIComponent(backupId)}/restore`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmation }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: RestoreSummary;
  } & ApiFailure;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The request could not be completed.");
  }

  return payload.data as RestoreSummary;
}
