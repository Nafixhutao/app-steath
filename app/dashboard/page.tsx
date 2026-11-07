"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useActiveOrganization } from "@/lib/auth-client";
import { listProjects, type ProjectSummary } from "@/lib/projects-client";

export default function DashboardPage() {
  const { data: organization } = useActiveOrganization();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const organizationId = organization?.id;

  const refresh = useCallback(async () => {
    if (!organizationId) return;
    try {
      setProjects(await listProjects());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Projects.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

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

      <section className="dashboard-section" aria-labelledby="resources-heading">
        <div className="dashboard-section-heading">
          <h2 id="resources-heading">
            Projects <span className="dashboard-count">{projects.length}</span>
          </h2>
          <Link href="/dashboard/projects">View Projects</Link>
        </div>

        {loading ? (
          <p className="dashboard-table-empty" role="status">
            Loading Projects...
          </p>
        ) : projects.length === 0 ? (
          <div className="dashboard-empty-state">
            <h3>No resources yet</h3>
            <p>Create a Project to deploy a Service or provision a PostgreSQL Database.</p>
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
                      <span className="role-label">
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
