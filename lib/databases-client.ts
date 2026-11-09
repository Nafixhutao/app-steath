export type DatabaseStatus = "provisioning" | "running" | "stopped" | "failed";

export type DatabaseSummary = {
  id: string;
  projectId: string;
  engine: "postgres";
  version: "16";
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
  createdAt: string;
  updatedAt: string;
};

export type OrganizationDatabaseSummary = DatabaseSummary & { projectName: string };

export type ProjectDatabase = {
  database: DatabaseSummary | null;
  needsRedeploy: boolean;
};

type ApiFailure = {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
};

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const payload = (await response.json().catch(() => ({}))) as { data?: T } & ApiFailure;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The request could not be completed.");
  }

  return payload.data as T;
}

export function getProjectDatabase(projectId: string): Promise<ProjectDatabase> {
  return request<ProjectDatabase>(`/api/projects/${encodeURIComponent(projectId)}/database`);
}

export function createProjectDatabase(
  projectId: string,
  input: { storageLimitMb?: number } = {},
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

export function listOrganizationDatabases(): Promise<OrganizationDatabaseSummary[]> {
  return request<OrganizationDatabaseSummary[]>("/api/databases");
}

const STATUS_LABELS: Record<DatabaseStatus, string> = {
  provisioning: "Provisioning",
  running: "Running",
  stopped: "Stopped",
  failed: "Failed",
};

export function databaseStatusLabel(status: DatabaseStatus): string {
  return STATUS_LABELS[status] ?? status;
}
