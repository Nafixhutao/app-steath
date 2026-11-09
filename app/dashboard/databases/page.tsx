"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useActiveOrganization } from "@/lib/auth-client";
import { QUOTAS } from "@/lib/platform/quota-limits";
import {
  databaseStatusLabel,
  listOrganizationDatabases,
  type OrganizationDatabaseSummary,
} from "@/lib/databases-client";

function getError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function usageLabel(database: OrganizationDatabaseSummary): string {
  if (database.usageMb === null) {
    return "Unavailable";
  }

  return `${database.usageMb} MB of ${database.storageLimitMb} MB`;
}

export default function DatabasesPage() {
  const { data: organization } = useActiveOrganization();
  const [databases, setDatabases] = useState<OrganizationDatabaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const organizationId = organization?.id;

  const refresh = useCallback(async () => {
    if (!organizationId) return;
    try {
      setDatabases(await listOrganizationDatabases());
      setError("");
    } catch (cause) {
      setError(getError(cause));
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
          <h1>Databases</h1>
          <p>Private PostgreSQL Databases, one per Project.</p>
        </div>
        <span className="project-quota">
          {databases.length} of {QUOTAS.databasesPerProject} per Project
        </span>
      </div>

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="dashboard-section" aria-labelledby="databases-list-heading">
        <div className="dashboard-section-heading">
          <h2 id="databases-list-heading">
            Databases <span className="dashboard-count">{databases.length}</span>
          </h2>
          <Link href="/dashboard/projects">View Projects</Link>
        </div>

        {loading ? (
          <p className="dashboard-table-empty" role="status">
            Loading Databases...
          </p>
        ) : databases.length === 0 ? (
          <div className="dashboard-empty-state">
            <h3>No Databases yet</h3>
            <p>Open a Project and create its private PostgreSQL Database.</p>
          </div>
        ) : (
          <div className="organization-table-wrap">
            <table className="organization-table">
              <thead>
                <tr>
                  <th>Database</th>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Health</th>
                  <th>Storage</th>
                </tr>
              </thead>
              <tbody>
                {databases.map((database) => (
                  <tr key={database.id}>
                    <td>
                      <strong>PostgreSQL {database.version}</strong>
                      <small>
                        {database.username}@{database.databaseName}
                      </small>
                    </td>
                    <td>
                      <Link href={`/dashboard/projects/${database.projectId}`}>
                        {database.projectName}
                      </Link>
                    </td>
                    <td>
                      <span className="role-label">{databaseStatusLabel(database.status)}</span>
                    </td>
                    <td>{database.healthy ? "Healthy" : "Unavailable"}</td>
                    <td>{usageLabel(database)}</td>
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
