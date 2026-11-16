export type ProjectSummary = {
  id: string;
  name: string;
  slug: string;
  serviceCount: number;
  databaseCount: number;
  status: "empty" | "active";
  createdAt: string;
  updatedAt: string;
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

export function listProjects(): Promise<ProjectSummary[]> {
  return request<ProjectSummary[]>("/api/projects");
}

export function getProject(projectId: string): Promise<ProjectSummary> {
  return request<ProjectSummary>(`/api/projects/${encodeURIComponent(projectId)}`);
}

export function createProject(input: { name: string; slug?: string }): Promise<ProjectSummary> {
  return request<ProjectSummary>("/api/projects", { method: "POST", body: input });
}

export function updateProject(
  projectId: string,
  input: { name?: string; slug?: string },
): Promise<ProjectSummary> {
  return request<ProjectSummary>(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: input,
  });
}

export function deleteProject(projectId: string, confirmation: string): Promise<{ id: string }> {
  return request<{ id: string }>(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    body: { confirmation },
  });
}
