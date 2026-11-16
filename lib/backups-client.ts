import { request } from "@/lib/platform/http";

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

export function getBackups(): Promise<BackupList> {
  return request<BackupList>("/api/backups");
}
