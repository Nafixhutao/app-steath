"use client";

import Link from "next/link";
import { useActiveOrganization } from "@/lib/auth-client";
import { listNodes, type NodeSummary } from "@/lib/deployments-client";
import { useResource } from "@/lib/resource";
import { listProjects, type ProjectSummary } from "@/lib/projects-client";

export default function DashboardPage() {
  const { data: organization } = useActiveOrganization();
  const organizationId = organization?.id;

  const overview = useResource(
    async () => {
      const [projectList, nodeList] = await Promise.all([listProjects(), listNodes()]);
      return { projects: projectList, nodes: nodeList };
    },
    [organizationId],
    { enabled: Boolean(organizationId) },
  );

  const projects: ProjectSummary[] = overview.data?.projects ?? [];
  const nodes: NodeSummary[] = overview.data?.nodes ?? [];
  const { loading, error } = overview;

  const node = nodes[0];
  const nodeHealthy = node?.status === "healthy";
  const totalServices = projects.reduce((sum, project) => sum + (project.serviceCount || 0), 0);
  const totalDatabases = projects.reduce((sum, project) => sum + (project.databaseCount || 0), 0);

  return (
    <div className="dashboard-content">
      <div className="dashboard-page-heading">
        <div>
          <h1>Overview</h1>
          <p>Manage hosting resources for {organization?.name ?? "your Organization"}.</p>
        </div>
      </div>

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
        </p>
      ) : null}

      {node && !nodeHealthy ? (
        <p className="dashboard-alert is-error" role="status">
          The Node Agent is not reporting in, so new Deployments are blocked until it recovers.
        </p>
      ) : null}

      <div className="dashboard-stats" aria-label="Resource summary">
        <div className="dashboard-stat">
          <span className="dashboard-stat-label">Projects</span>
          <span className="dashboard-stat-value">{projects.length}</span>
          <span className="dashboard-stat-meta">
            in {organization?.name ?? "your Organization"}
          </span>
        </div>
        <div className="dashboard-stat">
          <span className="dashboard-stat-label">Services</span>
          <span className="dashboard-stat-value">{totalServices}</span>
          <span className="dashboard-stat-meta">deployed across projects</span>
        </div>
        <div className="dashboard-stat">
          <span className="dashboard-stat-label">Databases</span>
          <span className="dashboard-stat-value">{totalDatabases}</span>
          <span className="dashboard-stat-meta">PostgreSQL instances</span>
        </div>
        <div className="dashboard-stat">
          <span className="dashboard-stat-label">Node</span>
          <span
            className={`dashboard-stat-value dashboard-node ${nodeHealthy ? "is-ok" : "is-down"}`}
          >
            <span className="dashboard-status-dot" aria-hidden="true" />
            {node ? (nodeHealthy ? "Healthy" : "Unavailable") : "None"}
          </span>
          <span className="dashboard-stat-meta">{node?.name ?? "Node Agent"}</span>
        </div>
      </div>

      <section className="dashboard-section" aria-labelledby="resources-heading">
        <div className="dashboard-section-heading">
          <h2 id="resources-heading">
            Projects <span className="dashboard-count">{projects.length}</span>
          </h2>
          <Link href="/dashboard/projects">View Projects</Link>
        </div>

        {loading ? (
          <div className="dashboard-skeleton" role="status" aria-label="Loading projects">
            <div className="dashboard-skeleton-row" />
            <div className="dashboard-skeleton-row" />
            <div className="dashboard-skeleton-row" />
            <span className="sr-only">Loading Projects…</span>
          </div>
        ) : projects.length === 0 ? (
          <div className="dashboard-empty-state">
            <h3>No resources yet</h3>
            <p>Create a Project to deploy a Service or provision a PostgreSQL Database.</p>
            <Link href="/dashboard/projects" className="create-project-button dashboard-empty-cta">
              Create a Project
            </Link>
          </div>
        ) : (
          <div className="organization-table-wrap">
            <table className="organization-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Services</th>
                  <th>Databases</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <strong>
                        <Link href={`/dashboard/projects/${project.id}`}>{project.name}</Link>
                      </strong>
                      <small>{project.slug}</small>
                    </td>
                    <td>{project.serviceCount}</td>
                    <td>{project.databaseCount}</td>
                    <td>
                      <span
                        className={`dashboard-status ${
                          project.status === "empty" ? "is-idle" : "is-active"
                        }`}
                      >
                        <span className="dashboard-status-dot" aria-hidden="true" />
                        {project.status === "empty" ? "Empty" : "Active"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
