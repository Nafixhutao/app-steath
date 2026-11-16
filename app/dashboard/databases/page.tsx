"use client";

import Link from "next/link";
import { useActiveOrganization } from "@/lib/auth-client";
import { QUOTAS } from "@/lib/platform/quota-limits";
import { useResource } from "@/lib/resource";
import {
  databaseStatusLabel,
  listOrganizationDatabases,
  type OrganizationDatabaseSummary,
} from "@/lib/databases-client";

function usageLabel(database: OrganizationDatabaseSummary): string {
  if (database.usageMb === null) {
    return "Unavailable";
  }

  return `${database.usageMb} MB of ${database.storageLimitMb} MB`;
}

export default function DatabasesPage() {
  const { data: organization } = useActiveOrganization();
  const organizationId = organization?.id;

  const databases = useResource(() => listOrganizationDatabases(), [organizationId], {
    enabled: Boolean(organizationId),
  });
  const databasesList: OrganizationDatabaseSummary[] = databases.data ?? [];

  return (
    <div className="dashboard-content">
      <div className="dashboard-page-heading">
        <div>
          <h1>Databases</h1>
          <p>Private PostgreSQL Databases, one per Project.</p>
        </div>
        <span className="project-quota">
          {databasesList.length} of {QUOTAS.databasesPerProject} per Project
        </span>
      </div>

      {databases.error ? (
        <p className="dashboard-alert is-error" role="alert">
          {databases.error}
        </p>
      ) : null}

      <section className="dashboard-section" aria-labelledby="databases-list-heading">
        <div className="dashboard-section-heading">
          <h2 id="databases-list-heading">
            Databases <span className="dashboard-count">{databasesList.length}</span>
          </h2>
          <Link href="/dashboard/projects">View Projects</Link>
        </div>

        {databases.loading ? (
          <p className="dashboard-table-empty" role="status">
            Loading Databases...
          </p>
        ) : databasesList.length === 0 ? (
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
                {databasesList.map((database) => (
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
