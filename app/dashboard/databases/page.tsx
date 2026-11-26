"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Database,
  Plus,
  Search,
  HardDrive,
  Layers,
  ArrowUpRight,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Copy,
  Check,
  X,
  Server,
  ShieldCheck,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { useActiveOrganization } from "@/lib/auth-client";
import { QUOTAS } from "@/lib/platform/quota-limits";
import { useResource } from "@/lib/resource";
import { useToast } from "@/components/toast-context";
import {
  databaseEngineLabel,
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

  return percent >= 80 ? "is-amber" : "is-healthy";
}

function usageLabel(database: OrganizationDatabaseSummary): string {
  if (database.usageMb === null) {
    return "Unavailable";
  }

  return `${database.usageMb} MB`;
}

/**
 * The engines in use, e.g. `PostgreSQL 16` or `PostgreSQL 16 + MySQL 8`. The
 * card has room for one line, so more than two engines collapse to a count.
 */
function engineSummary(databases: OrganizationDatabaseSummary[]): string {
  const engines = new Map<string, string>();
  for (const database of databases) {
    engines.set(database.engine, databaseEngineLabel(database.engine, database.version));
  }
  if (engines.size === 0) {
    return "PostgreSQL 16 · MySQL 8";
  }
  if (engines.size > 2) {
    return `${engines.size} engines`;
  }

  return [...engines.values()].join(" + ");
}

export default function DatabasesPage() {
  const { toast } = useToast();
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
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const byStatus = new Map<DatabaseStatus, number>();
    for (const database of databasesList) {
      byStatus.set(database.status, (byStatus.get(database.status) ?? 0) + 1);
    }

    return byStatus;
  }, [databasesList]);

  const totalUsedStorage = useMemo(() => {
    return databasesList.reduce((acc, curr) => acc + (curr.usageMb ?? 0), 0);
  }, [databasesList]);

  const totalAllocatedStorage = useMemo(() => {
    return databasesList.reduce((acc, curr) => acc + curr.storageLimitMb, 0);
  }, [databasesList]);

  const runningCount = counts.get("running") ?? 0;

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

  const fullDatabase = useMemo(
    () =>
      databasesList
        .map((database) => ({ database, percent: diskPercent(database) }))
        .find((entry) => entry.percent !== null && entry.percent >= 80),
    [databasesList],
  );

  function copyToClipboard(id: string, text: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(() => {
        setCopiedId(id);
        toast.success("Copied to clipboard", text);
        setTimeout(() => setCopiedId(null), 2000);
      });
    }
  }

  return (
    <div className="dashboard-content db-page-wrapper">
      {/* Header */}
      <header className="db-heading">
        <div className="flex-1 min-w-[280px]">
          <div className="flex items-center gap-[14px]">
            <div className="db-title-icon-box" aria-hidden="true">
              <Database className="w-[22px] h-[22px]" />
            </div>
            <div>
              <div className="[font-family:var(--font-mono)] text-[11px] font-semibold uppercase tracking-[0.08em] text-accent mb-[2px]">Managed Storage</div>
              <h1>Databases</h1>
            </div>
          </div>
          <p className="db-description">
            Dedicated PostgreSQL 16 or MySQL 8 instances with private networking, connection
            isolation, and automated daily backups.
          </p>
        </div>
        <div className="db-actions">
          <span className="db-quota" title="Limit per project in this organization">
            <Server className="w-[14px] h-[14px] text-accent" aria-hidden="true" />
            <span>
              {databasesList.length} of {QUOTAS.databasesPerProject} per Project
            </span>
          </span>
          <Link href="/dashboard/projects" className="db-btn db-btn-primary">
            <Plus className="db-btn-icon" aria-hidden="true" />
            <span>New Database</span>
          </Link>
        </div>
      </header>

      {databases.error ? (
        <div className="dashboard-alert is-error" role="alert">
          <AlertCircle className="db-alert-icon" aria-hidden="true" />
          <span>{databases.error}</span>
        </div>
      ) : null}

      {/* Warning banner for disk usage threshold */}
      {fullDatabase ? (
        <div className="db-banner" role="region" aria-label="Storage warning">
          <div className="flex items-start gap-[12px] min-w-[240px] flex-1">
            <div className="db-banner-icon-box" aria-hidden="true">
              <AlertTriangle className="w-[18px] h-[18px]" />
            </div>
            <div className="flex flex-col gap-[2px]">
              <p className="db-banner-text">
                <strong>{fullDatabase.database.databaseName}</strong> has used{" "}
                <span className="[font-family:var(--font-mono)] font-bold text-[#f59e0b]">{fullDatabase.percent}%</span> of its{" "}
                {fullDatabase.database.storageLimitMb} MB disk allocation.
              </p>
              <p className="db-banner-subtext">
                Expand disk storage before usage reaches 95% to prevent automatic read-only lock.
              </p>
            </div>
          </div>
          <Link
            href={`/dashboard/projects/${fullDatabase.database.projectId}`}
            className="db-btn db-btn-warning"
          >
            <span>Expand Storage</span>
            <ArrowUpRight className="db-btn-icon" aria-hidden="true" />
          </Link>
        </div>
      ) : null}

      {/* Overview Metric Cards */}
      <section className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-[14px] mt-[24px]" aria-label="Database overview metrics">
        <div className="db-metric-card">
          <div className="db-metric-header">
            <span className="db-metric-label">Total Databases</span>
            <Database className="db-metric-icon text-indigo" aria-hidden="true" />
          </div>
          <div className="db-metric-value">{databasesList.length}</div>
          <div className="db-metric-meta">
            {databasesList.length === 0
              ? "No databases created"
              : `${runningCount} currently active`}
          </div>
        </div>

        <div className="db-metric-card">
          <div className="db-metric-header">
            <span className="db-metric-label">Engine & Health</span>
            <CheckCircle2 className="db-metric-icon text-emerald" aria-hidden="true" />
          </div>
          <div className="db-metric-value">{engineSummary(databasesList)}</div>
          <div className="db-metric-meta">
            {databasesList.length > 0 && runningCount === databasesList.length
              ? "All instances operational"
              : databasesList.length > 0
                ? `${runningCount} of ${databasesList.length} operational`
                : "Private container isolation"}
          </div>
        </div>

        <div className="db-metric-card">
          <div className="db-metric-header">
            <span className="db-metric-label">Allocated Storage</span>
            <HardDrive className="db-metric-icon text-amber" aria-hidden="true" />
          </div>
          <div className="db-metric-value">
            {totalAllocatedStorage > 0 ? `${totalUsedStorage} MB` : "0 MB"}
          </div>
          <div className="db-metric-meta">
            {totalAllocatedStorage > 0
              ? `of ${totalAllocatedStorage} MB total capacity`
              : "1024 MB quota per project"}
          </div>
        </div>
      </section>

      {/* Search and Filters toolbar (only when databases exist) */}
      {databasesList.length > 0 && (
        <div className="flex items-center justify-between gap-[14px] flex-wrap mt-[24px]">
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
                  {filter.value !== "all" && (
                    <span
                      className={`db-chip-dot ${STATUS_DOT[filter.value as DatabaseStatus]}`}
                      aria-hidden="true"
                    />
                  )}
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
            <Search className="absolute left-[12px] top-1/2 w-[16px] h-[16px] -translate-y-1/2 text-[#757180] pointer-events-none" aria-hidden="true" />
            <input
              type="search"
              id="db-search-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search database, project, or user..."
              autoComplete="off"
            />
            {search ? (
              <button
                type="button"
                className="db-search-clear"
                onClick={() => setSearch("")}
                aria-label="Clear search input"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {databases.loading ? (
        <div className="db-table-container">
          <div className="flex flex-col items-center justify-center gap-[12px] py-[64px] px-[20px] text-[#9e9aa7] text-[13.5px]" role="status">
            <RefreshCw className="w-[24px] h-[24px] text-accent animate-[db-spin_1s_linear_infinite]" aria-hidden="true" />
            <p>Fetching databases in this organization...</p>
          </div>
        </div>
      ) : databasesList.length === 0 ? (
        /* Empty State: No databases created in organization */
        <div className="db-empty-hero">
          <div className="relative flex justify-center mb-[20px]" aria-hidden="true">
            <div className="db-empty-glow" />
            <div className="db-empty-icon-card">
              <Database className="w-[30px] h-[30px]" />
            </div>
          </div>
          <h2>No databases provisioned yet</h2>
          <p className="db-empty-lead">
            Every project in Stealth Hosting can host its own dedicated PostgreSQL 16 or MySQL 8
            database. Databases run in private container networks with persistent storage and
            scheduled backups.
          </p>

          <Link href="/dashboard/projects" className="db-btn db-btn-primary mx-auto">
            <Plus className="db-btn-icon" aria-hidden="true" />
            <span>Go to Projects to Create Database</span>
          </Link>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[16px] max-w-[820px] mt-[48px] mb-0 mx-auto text-left">
            <div className="db-feature-item">
              <div className="db-feature-icon-box">
                <ShieldCheck className="db-feature-icon text-emerald" />
              </div>
              <div>
                <h3>Private by Default</h3>
                <p>Never exposed to the public internet unless you explicitly enable the proxy.</p>
              </div>
            </div>
            <div className="db-feature-item">
              <div className="db-feature-icon-box">
                <HardDrive className="db-feature-icon text-indigo" />
              </div>
              <div>
                <h3>1024 MB Storage</h3>
                <p>High-performance NVMe storage volume tied directly to your project.</p>
              </div>
            </div>
            <div className="db-feature-item">
              <div className="db-feature-icon-box">
                <RefreshCw className="db-feature-icon text-amber" />
              </div>
              <div>
                <h3>Automated Backups</h3>
                <p>Scheduled daily backups with simple point-in-time restore capability.</p>
              </div>
            </div>
          </div>
        </div>
      ) : visibleDatabases.length === 0 ? (
        /* Empty State: Search or filter has no matching records */
        <div className="db-empty-box">
          <div className="db-filter-empty-icon" aria-hidden="true">
            <SlidersHorizontal className="w-6 h-6 text-muted" />
          </div>
          <h2>No databases match the filter</h2>
          <p>
            No databases match your current query &ldquo;{search}&rdquo; or the selected status
            filter.
          </p>
          <button
            type="button"
            className="db-btn db-btn-sm border border-[#2a2834] bg-[#181720] text-[#f3f2f5] hover:border-[#3b3749] hover:bg-[#201e2a]"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
            }}
          >
            <span>Reset filters</span>
          </button>
        </div>
      ) : (
        /* Databases Table */
        <div className="db-table-container">
          <table className="db-table">
            <thead>
              <tr>
                <th scope="col">Database & User</th>
                <th scope="col">Project</th>
                <th scope="col">Status</th>
                <th scope="col">Engine</th>
                <th scope="col">Disk Usage</th>
                <th scope="col" className="text-right">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleDatabases.map((database) => {
                const percent = diskPercent(database);
                const copyText = `${database.username}@${database.databaseName}`;
                const isCopied = copiedId === database.id;

                return (
                  <tr key={database.id}>
                    <td>
                      <div className="flex items-center gap-[12px]">
                        <div className="db-row-icon-box" aria-hidden="true">
                          <Database className="w-[16px] h-[16px]" />
                        </div>
                        <div className="flex flex-col">
                          <span className="[font-family:var(--font-mono)] font-semibold text-[14px] text-ink">{database.databaseName}</span>
                          <div className="db-connection-pill">
                            <span className="truncate max-w-[200px]">{copyText}</span>
                            <button
                              type="button"
                              className="db-copy-btn"
                              onClick={() => copyToClipboard(database.id, copyText)}
                              title="Copy username and database name"
                              aria-label={`Copy credentials for ${database.databaseName}`}
                            >
                              {isCopied ? (
                                <Check className="db-copy-icon text-emerald" aria-hidden="true" />
                              ) : (
                                <Copy className="db-copy-icon" aria-hidden="true" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>

                    <td>
                      <Link
                        href={`/dashboard/projects/${database.projectId}`}
                        className="db-project-link"
                      >
                        <Layers className="w-[14px] h-[14px] text-accent" aria-hidden="true" />
                        <span>{database.projectName}</span>
                      </Link>
                    </td>

                    <td>
                      <span className={`db-status-pill ${STATUS_DOT[database.status]}`}>
                        <span className="relative inline-flex" aria-hidden="true">
                          <span className={`db-dot ${STATUS_DOT[database.status]}`} />
                        </span>
                        <span className="db-status-text">
                          {databaseStatusLabel(database.status)}
                        </span>
                      </span>
                    </td>

                    <td>
                      <span className="db-engine-pill">
                        {databaseEngineLabel(database.engine, database.version)}
                      </span>
                    </td>

                    <td>
                      <div className="min-w-[170px]">
                        <div className="db-disk-meta">
                          <span className="db-disk-used">{usageLabel(database)}</span>
                          <span className="db-disk-cap">of {database.storageLimitMb} MB</span>
                        </div>
                        {percent === null ? null : (
                          <div
                            className="w-full h-[7px] border border-[#272531] rounded-control bg-[#100f14] overflow-hidden"
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
                        {percent !== null && (
                          <div className="mt-[4px] text-[11px] text-[#757180] text-right">
                            <span className="[font-family:var(--font-mono)]">{percent}% utilized</span>
                          </div>
                        )}
                      </div>
                    </td>

                    <td className="text-right">
                      <Link
                        href={`/dashboard/projects/${database.projectId}`}
                        className="db-btn db-btn-manage"
                        title={`Manage ${database.databaseName} in ${database.projectName}`}
                      >
                        <span>Manage</span>
                        <ArrowUpRight className="w-[13px] h-[13px] text-[#9e9aa7]" aria-hidden="true" />
                      </Link>
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
