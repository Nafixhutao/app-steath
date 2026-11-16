export type BackupTargetType = "database" | "volume" | "platform";
export type BackupStatus = "pending" | "running" | "completed" | "failed";
export type BackupStorageProvider = "s3" | "local";

export type BackupSummary = {
  id: string;
  targetType: BackupTargetType;
  targetName: string;
  projectName: string | null;
  status: BackupStatus;
  storageProvider: BackupStorageProvider | null;
  sizeBytes: number;
  errorMessage: string | null;
  createdAt: string;
  expiresAt: string;
};

export type BackupList = {
  backups: BackupSummary[];
  /** What a new Backup would use right now, so the dashboard can warn. */
  storageProvider: BackupStorageProvider;
};

type ApiFailure = {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
};

export async function getBackups(): Promise<BackupList> {
  const response = await fetch("/api/backups");
  const payload = (await response.json().catch(() => ({}))) as {
    data?: BackupList;
  } & ApiFailure;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The request could not be completed.");
  }

  return payload.data as BackupList;
}
