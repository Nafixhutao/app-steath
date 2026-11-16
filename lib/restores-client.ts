import { request } from "@/lib/platform/http";

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

export function getRestores(): Promise<RestoreList> {
  return request<RestoreList>("/api/restores");
}

/**
 * Asks the Control Plane to restore one Backup. The confirmation is the target
 * name the user sees, so the request cannot be started by an accidental click.
 */
export function requestRestore(backupId: string, confirmation: string): Promise<RestoreSummary> {
  return request<RestoreSummary>(`/api/backups/${encodeURIComponent(backupId)}/restore`, {
    method: "POST",
    body: { confirmation },
  });
}
