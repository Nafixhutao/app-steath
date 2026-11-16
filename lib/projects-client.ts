import { request } from "@/lib/platform/http";

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
