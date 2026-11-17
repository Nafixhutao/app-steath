"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useActiveOrganization } from "@/lib/auth-client";
import { QUOTAS } from "@/lib/platform/quota-limits";
import { useResource } from "@/lib/resource";
import {
  databaseStatusLabel,
  listOrganizationDatabases,
  type DatabaseStatus,
  type OrganizationDatabaseSummary,
} from "@/lib/databases-client";

const STATUS_FILTERS: Array<{ value: DatabaseStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "provisioning", label: "Provisioning" },
  { value: "stopped", label: "Stopped" },
  { value: "failed", label: "Failed" },
];

const STATUS_DOT: Record<DatabaseStatus, string> = {
  running: "is-running",
  provisioning: "is-provisioning",
  stopped: "is-stopped",
  failed: "is-failed",
};

/** Disk fills turn amber at 80% and red at 95%, matching the warning banner. */
function diskPercent(database: OrganizationDatabaseSummary): number | null {
  if (database.usageMb === null || database.storageLimitMb <= 0) {
    return null;
  }

  return Math.min(100, Math.round((database.usageMb / database.storageLimitMb) * 100));
}

function diskFillClass(percent: number): string {
  if (percent >= 95) {
    return "is-red";
  }

  return percent >= 80 ? "is-amber" : "";
}

function usageLabel(database: OrganizationDatabaseSummary): string {
  if (database.usageMb === null) {
    return "Unavailable";
  }

  return `${database.usageMb} MB`;
}

export default function DatabasesPage() {
  const { data: organization } = useActiveOrganization();
  const organizationId = organization?.id;

  const databases = useResource(() => listOrganizationDatabases(), [organizationId], {
    enabled: Boolean(organizationId),
  });
  const databasesList: OrganizationDatabaseSummary[] = useMemo(
    () => databases.data ?? [],
    [databases.data],
  );

  const [statusFilter, setStatusFilter] = useState<DatabaseStatus | "all">("all");
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const byStatus = new Map<DatabaseStatus, number>();
    for (const database of databasesList) {
      byStatus.set(database.status, (byStatus.get(database.status) ?? 0) + 1);
    }

    return byStatus;
  }, [databasesList]);

  const visibleDatabases = useMemo(() => {
    const query = search.trim().toLowerCase();
    return databasesList.filter((database) => {
      if (statusFilter !== "all" && database.status !== statusFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [database.databaseName, database.projectName, database.username].some((value) =>
        value.toLowerCase().includes(query),
      );
    });
  }, [databasesList, statusFilter, search]);

  const statusSummary = useMemo(() => {
    const parts: string[] = [];
    for (const { value, label } of STATUS_FILTERS.slice(1)) {
      const count = counts.get(value as DatabaseStatus) ?? 0;
      if (count > 0) {
        parts.push(`${count} ${label.toLowerCase()}`);
      }
    }

    return parts.join(", ");
  }, [counts]);

  const fullDatabase = useMemo(
    () =>
      databasesList
        .map((database) => ({ database, percent: diskPercent(database) }))
        .find((entry) => entry.percent !== null && entry.percent >= 80),
    [databasesList],
  );

  const subtitle =
    databasesList.length === 0
      ? "Private PostgreSQL Databases, one per Project."
      : `${databasesList.length} database${databasesList.length === 1 ? "" : "s"}${
          statusSummary ? ` · ${statusSummary}` : ""
        }`;

  return (
    <div className="dashboard-content">
      <header className="db-heading">
        <div>
          <h1>Databases</h1>
          <p>{subtitle}</p>
        </div>
        <div className="db-actions">
          <span className="db-quota">
            {databasesList.length} of {QUOTAS.databasesPerProject} per Project
          </span>
          <Link href="/dashboard/projects" className="db-btn db-btn-primary">
            Create database
          </Link>
        </div>
      </header>

      {databases.error ? (
        <p className="dashboard-alert is-error" role="alert">
          {databases.error}
        </p>
      ) : null}

      {fullDatabase ? (
        <div className="db-banner" role="region" aria-label="Storage warning">
          <div className="db-banner-content">
            <span className="db-banner-dot" aria-hidden="true" />
            <p className="db-banner-text">
              <span className="db-name">{fullDatabase.database.databaseName}</span> has used{" "}
              <span className="db-name">{fullDatabase.percent}%</span> of its{" "}
              <span className="db-name">{fullDatabase.database.storageLimitMb} MB</span> disk.{" "}
              <span className="db-banner-subtext">
                Expand storage before usage reaches 95% to prevent a read-only lock.
              </span>
            </p>
          </div>
          <Link
            href={`/dashboard/projects/${fullDatabase.database.projectId}`}
            className="db-btn db-btn-surface"
          >
            Add storage
          </Link>
        </div>
      ) : null}

      <div className="db-controls">
        <div className="db-chip-group" role="group" aria-label="Filter databases by status">
          {STATUS_FILTERS.map((filter) => {
            const count =
              filter.value === "all" ? databasesList.length : (counts.get(filter.value) ?? 0);

            return (
              <button
                key={filter.value}
                type="button"
                className="db-chip"
                aria-pressed={statusFilter === filter.value}
                onClick={() => setStatusFilter(filter.value)}
              >
                <span>{filter.label}</span>
                <span className="db-chip-count">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="db-search">
          <label htmlFor="db-search-input" className="sr-only">
            Search databases by name, project, or user
          </label>
          <svg
            className="db-search-icon"
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <circle cx="7" cy="7" r="4.5" />
            <line x1="10.2" y1="10.2" x2="14" y2="14" />
          </svg>
          <input
            type="search"
            id="db-search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, project, or user"
            autoComplete="off"
          />
        </div>
      </div>

      {databases.loading ? (
        <div className="db-empty-box" role="status">
          <h2>Loading Databases...</h2>
          <p>Fetching the Databases in this Organization.</p>
        </div>
      ) : visibleDatabases.length === 0 ? (
        <div className="db-empty-box">
          <h2>
            {databasesList.length === 0 ? "No Databases yet" : "No Databases match the filter"}
          </h2>
          <p>
            {databasesList.length === 0
              ? "Open a Project and create its private PostgreSQL Database."
              : "Try a different status chip or clear the search field."}
          </p>
        </div>
      ) : (
        <div className="db-table-container">
          <table className="db-table">
            <thead>
              <tr>
                <th scope="col">Database</th>
                <th scope="col">Project</th>
                <th scope="col">Status</th>
                <th scope="col">Engine</th>
                <th scope="col">Storage</th>
              </tr>
            </thead>
            <tbody>
              {visibleDatabases.map((database) => {
                const percent = diskPercent(database);

                return (
                  <tr key={database.id}>
                    <td>
                      <span className="db-name">
                        {database.databaseName}
                        <small>
                          {database.username}@{database.databaseName}
                        </small>
                      </span>
                    </td>
                    <td>
                      <Link href={`/dashboard/projects/${database.projectId}`}>
                        {database.projectName}
                      </Link>
                    </td>
                    <td>
                      <span className="db-status">
                        <span
                          className={`db-dot ${STATUS_DOT[database.status]}`}
                          aria-hidden="true"
                        />
                        {databaseStatusLabel(database.status)}
                      </span>
                    </td>
                    <td>PostgreSQL {database.version}</td>
                    <td>
                      <div className="db-disk">
                        <div className="db-disk-meta">
                          <span className="db-disk-used">{usageLabel(database)}</span>
                          <span className="db-disk-cap">of {database.storageLimitMb} MB</span>
                        </div>
                        {percent === null ? null : (
                          <div
                            className="db-disk-track"
                            role="progressbar"
                            aria-label={`Disk usage for ${database.databaseName}`}
                            aria-valuenow={percent}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <div
                              className={`db-disk-fill ${diskFillClass(percent)}`}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
