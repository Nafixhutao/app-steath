import { request } from "@/lib/platform/http";

export type DatabaseStatus = "provisioning" | "running" | "stopped" | "failed";

export type DatabaseEngine = "postgres" | "mysql";

/**
 * The phpMyAdmin sidecar a MySQL Database always gets. PostgreSQL has no browser
 * client, so every field is empty for it.
 */
export type DatabasePhpMyAdminSummary = {
  enabled: boolean;
  url: string | null;
  hostname: string | null;
  ready: boolean;
};

/**
 * The opt-in public endpoint for a Database. It is disabled by default, it is
 * only available on PostgreSQL, and the public connection string is only present
 * for owners and admins.
 */
export type DatabaseProxySummary = {
  enabled: boolean;
  port: number | null;
  allowlist: string[];
  connectionString: string | null;
};

export type DatabaseSummary = {
  id: string;
  projectId: string;
  engine: DatabaseEngine;
  version: string;
  databaseName: string;
  username: string;
  storageLimitMb: number;
  status: DatabaseStatus;
  healthy: boolean;
  /** Measured by the Node Agent; null when the node could not be asked. */
  usageMb: number | null;
  overQuota: boolean;
  /** Only owners and admins receive the private connection string. */
  connectionString: string | null;
  /** The opt-in public endpoint. PostgreSQL only. */
  proxy: DatabaseProxySummary;
  /** The browser client a MySQL Database serves on the Platform Domain. */
  phpMyAdmin: DatabasePhpMyAdminSummary;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationDatabaseSummary = DatabaseSummary & { projectName: string };

export type ProjectDatabase = {
  database: DatabaseSummary | null;
  needsRedeploy: boolean;
};

export function getProjectDatabase(projectId: string): Promise<ProjectDatabase> {
  return request<ProjectDatabase>(`/api/projects/${encodeURIComponent(projectId)}/database`);
}

export function createProjectDatabase(
  projectId: string,
  input: { engine?: DatabaseEngine; storageLimitMb?: number } = {},
): Promise<DatabaseSummary> {
  return request<DatabaseSummary>(`/api/projects/${encodeURIComponent(projectId)}/database`, {
    method: "POST",
    body: input,
  });
}

export function deleteProjectDatabase(
  projectId: string,
  confirmation: string,
): Promise<{ id: string }> {
  return request<{ id: string }>(`/api/projects/${encodeURIComponent(projectId)}/database`, {
    method: "DELETE",
    body: { confirmation },
  });
}

export function rotateProjectDatabaseCredentials(projectId: string): Promise<DatabaseSummary> {
  return request<DatabaseSummary>(
    `/api/projects/${encodeURIComponent(projectId)}/database/rotate`,
    {
      method: "POST",
    },
  );
}

/**
 * Reads the Database password on demand, for the Reveal button. It is fetched
 * only when the user asks, so the value is never part of the page payload the
 * browser caches or a log record. The API answers `{ password }`.
 */
export function revealProjectDatabasePassword(projectId: string): Promise<{ password: string }> {
  return request<{ password: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/database/password`,
  );
}

/**
 * Asks the API for a one-time phpMyAdmin sign-in link. The returned URL is on the
 * phpMyAdmin hostname, expires in 60 seconds, and works once.
 */
export function startPhpMyAdminSession(
  projectId: string,
): Promise<{ url: string; expiresInSeconds: number }> {
  return request<{ url: string; expiresInSeconds: number }>(
    `/api/projects/${encodeURIComponent(projectId)}/database/phpmyadmin`,
    { method: "POST" },
  );
}

export function listOrganizationDatabases(): Promise<OrganizationDatabaseSummary[]> {  return request<OrganizationDatabaseSummary[]>("/api/databases");
}

export function getProjectDatabaseProxy(projectId: string): Promise<DatabaseProxySummary> {
  return request<DatabaseProxySummary>(
    `/api/projects/${encodeURIComponent(projectId)}/database/proxy`,
  );
}

export function enableProjectDatabaseProxy(
  projectId: string,
  allowlist: string[],
): Promise<DatabaseProxySummary> {
  return request<DatabaseProxySummary>(
    `/api/projects/${encodeURIComponent(projectId)}/database/proxy`,
    { method: "PUT", body: { allowlist } },
  );
}

export function disableProjectDatabaseProxy(projectId: string): Promise<DatabaseProxySummary> {
  return request<DatabaseProxySummary>(
    `/api/projects/${encodeURIComponent(projectId)}/database/proxy`,
    { method: "DELETE" },
  );
}

const STATUS_LABELS: Record<DatabaseStatus, string> = {
  provisioning: "Provisioning",
  running: "Running",
  stopped: "Stopped",
  failed: "Failed",
};

const ENGINE_LABELS: Record<DatabaseEngine, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
};

export function databaseStatusLabel(status: DatabaseStatus): string {
  return STATUS_LABELS[status] ?? status;
}

/** The engine name the dashboard shows, e.g. `MySQL 8`. */
export function databaseEngineLabel(engine: DatabaseEngine, version: string): string {
  return `${ENGINE_LABELS[engine] ?? engine} ${version}`;
}
