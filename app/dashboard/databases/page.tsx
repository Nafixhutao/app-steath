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
    <div className="dashboard-content max-w-[1200px]">
      {/* Header */}
      <header className="db-heading">
        <div className="flex-1 min-w-[280px]">
          <div className="flex items-center gap-[14px]">
            <div className="flex items-center justify-center w-[44px] h-[44px] rounded-card-lg [background:linear-gradient(135deg,rgba(99,102,241,0.16)_0%,rgba(62,207,142,0.08)_100%)] border border-[rgba(99,102,241,0.28)] text-accent shrink-0" aria-hidden="true">
              <Database className="w-[22px] h-[22px]" />
            </div>
            <div>
              <div className="[font-family:var(--font-mono)] text-[11px] font-semibold uppercase tracking-[0.08em] text-accent mb-[2px]">Managed Storage</div>
              <h1>Databases</h1>
            </div>
          </div>
          <p className="mt-[8px] mb-0 mx-0 max-w-[620px] text-[#9e9aa7] text-[14px] leading-[1.55]">
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
            <Plus className="w-[15px] h-[15px]" aria-hidden="true" />
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
            <div className="flex items-center justify-center w-[32px] h-[32px] rounded-card bg-[rgba(245,158,11,0.15)] text-[#f59e0b] shrink-0 mt-[2px]" aria-hidden="true">
              <AlertTriangle className="w-[18px] h-[18px]" />
            </div>
            <div className="flex flex-col gap-[2px]">
              <p className="m-0 text-[#f3f2f5] text-[13.5px] leading-[1.45]">
                <strong>{fullDatabase.database.databaseName}</strong> has used{" "}
                <span className="[font-family:var(--font-mono)] font-bold text-[#f59e0b]">{fullDatabase.percent}%</span> of its{" "}
                {fullDatabase.database.storageLimitMb} MB disk allocation.
              </p>
              <p className="m-0 text-[#9e9aa7] text-[12.5px] leading-[1.4]">
                Expand disk storage before usage reaches 95% to prevent automatic read-only lock.
              </p>
            </div>
          </div>
          <Link
            href={`/dashboard/projects/${fullDatabase.database.projectId}`}
            className="db-btn-warning db-btn border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.12)] hover:bg-[rgba(245,158,11,0.2)] hover:border-[rgba(245,158,11,0.6)]"
          >
            <span>Expand Storage</span>
            <ArrowUpRight className="w-[15px] h-[15px]" aria-hidden="true" />
          </Link>
        </div>
      ) : null}

      {/* Overview Metric Cards */}
      <section className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-[14px] mt-[24px]" aria-label="Database overview metrics">
        <div className="py-[16px] px-[20px] rounded-card-lg bg-[#15141b] border border-[#272531] [box-shadow:0_2px_8px_rgba(0,0,0,0.2)] [transition:border-color_150ms_ease] hover:border-[#383546]">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#8a8694] uppercase tracking-[0.04em]">Total Databases</span>
            <Database className="db-metric-icon text-indigo" aria-hidden="true" />
          </div>
          <div className="mt-[8px] text-[22px] font-bold text-ink tracking-[-0.01em]">{databasesList.length}</div>
          <div className="mt-[4px] text-[12px] text-[#9e9aa7]">
            {databasesList.length === 0
              ? "No databases created"
              : `${runningCount} currently active`}
          </div>
        </div>

        <div className="py-[16px] px-[20px] rounded-card-lg bg-[#15141b] border border-[#272531] [box-shadow:0_2px_8px_rgba(0,0,0,0.2)] [transition:border-color_150ms_ease] hover:border-[#383546]">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#8a8694] uppercase tracking-[0.04em]">Engine & Health</span>
            <CheckCircle2 className="db-metric-icon text-emerald" aria-hidden="true" />
          </div>
          <div className="mt-[8px] text-[22px] font-bold text-ink tracking-[-0.01em]">{engineSummary(databasesList)}</div>
          <div className="mt-[4px] text-[12px] text-[#9e9aa7]">
            {databasesList.length > 0 && runningCount === databasesList.length
              ? "All instances operational"
              : databasesList.length > 0
                ? `${runningCount} of ${databasesList.length} operational`
                : "Private container isolation"}
          </div>
        </div>

        <div className="py-[16px] px-[20px] rounded-card-lg bg-[#15141b] border border-[#272531] [box-shadow:0_2px_8px_rgba(0,0,0,0.2)] [transition:border-color_150ms_ease] hover:border-[#383546]">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#8a8694] uppercase tracking-[0.04em]">Allocated Storage</span>
            <HardDrive className="db-metric-icon text-amber" aria-hidden="true" />
          </div>
          <div className="mt-[8px] text-[22px] font-bold text-ink tracking-[-0.01em]">
            {totalAllocatedStorage > 0 ? `${totalUsedStorage} MB` : "0 MB"}
          </div>
          <div className="mt-[4px] text-[12px] text-[#9e9aa7]">
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
                className="absolute right-[10px] top-1/2 -translate-y-1/2 flex items-center justify-center w-[22px] h-[22px] border-0 rounded-[50%] bg-[#272531] text-[#9e9aa7] cursor-pointer [transition:background_120ms_ease,color_120ms_ease] hover:bg-[#393647] hover:text-ink"
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
        <div className="db-table-container mt-[18px] border border-[#272530] rounded-card-lg bg-[#15141b] overflow-x-auto [box-shadow:0_4px_20px_rgba(0,0,0,0.2)]">
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
            <div className="flex items-center justify-center w-[64px] h-[64px] rounded-[18px] [background:linear-gradient(135deg,#1e1c27_0%,#15141d_100%)] border border-[#373347] text-accent [box-shadow:0_8px_30px_rgba(99,102,241,0.2)]">
              <Database className="w-[30px] h-[30px]" />
            </div>
          </div>
          <h2>No databases provisioned yet</h2>
          <p className="max-w-[520px] mt-[10px] mb-[26px] mx-auto text-[#9e9aa7] text-[14px] leading-[1.6]">
            Every project in Stealth Hosting can host its own dedicated PostgreSQL 16 or MySQL 8
            database. Databases run in private container networks with persistent storage and
            scheduled backups.
          </p>

          <Link href="/dashboard/projects" className="db-btn db-btn-primary mx-auto">
            <Plus className="w-[15px] h-[15px]" aria-hidden="true" />
            <span>Go to Projects to Create Database</span>
          </Link>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[16px] max-w-[820px] mt-[48px] mb-0 mx-auto text-left">
            <div className="db-feature-item">
              <div className="flex items-center justify-center w-[32px] h-[32px] rounded-card bg-[#201e2a] shrink-0">
                <ShieldCheck className="db-feature-icon text-emerald" />
              </div>
              <div>
                <h3>Private by Default</h3>
                <p>Never exposed to the public internet unless you explicitly enable the proxy.</p>
              </div>
            </div>
            <div className="db-feature-item">
              <div className="flex items-center justify-center w-[32px] h-[32px] rounded-card bg-[#201e2a] shrink-0">
                <HardDrive className="db-feature-icon text-indigo" />
              </div>
              <div>
                <h3>1024 MB Storage</h3>
                <p>High-performance NVMe storage volume tied directly to your project.</p>
              </div>
            </div>
            <div className="db-feature-item">
              <div className="flex items-center justify-center w-[32px] h-[32px] rounded-card bg-[#201e2a] shrink-0">
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
          <div className="flex items-center justify-center w-[44px] h-[44px] mt-0 mb-[14px] mx-auto rounded-card-lg bg-[#1d1b25] text-[#757180]" aria-hidden="true">
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
        <div className="db-table-container mt-[18px] border border-[#272530] rounded-card-lg bg-[#15141b] overflow-x-auto [box-shadow:0_4px_20px_rgba(0,0,0,0.2)]">
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
                        <div className="flex items-center justify-center w-[34px] h-[34px] rounded-card bg-[rgba(62,207,142,0.08)] border border-[rgba(62,207,142,0.2)] text-accent shrink-0" aria-hidden="true">
                          <Database className="w-[16px] h-[16px]" />
                        </div>
                        <div className="flex flex-col">
                          <span className="[font-family:var(--font-mono)] font-semibold text-[14px] text-ink">{database.databaseName}</span>
                          <div className="inline-flex items-center gap-[6px] mt-[3px] py-[2px] px-[7px] bg-[#100f14] border border-[#25232d] rounded-control [font-family:var(--font-mono)] text-[11px] text-[#9e9aa7]">
                            <span className="truncate max-w-[200px]">{copyText}</span>
                            <button
                              type="button"
                              className="inline-flex items-center justify-center p-[1px] border-0 bg-transparent text-[#757180] cursor-pointer [transition:color_120ms_ease] hover:text-ink focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-2"
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
                        className="db-project-link inline-flex items-center gap-[7px] no-underline font-medium [transition:color_120ms_ease] hover:underline focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px]"
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
                      <span className="inline-flex py-[3px] px-[8px] rounded-control bg-[#1e1d27] border border-[#2d2b38] [font-family:var(--font-mono)] text-[11.5px] text-[#d1d0d8] whitespace-nowrap">
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
                        className="db-btn-manage db-btn bg-[#1c1a24] border border-[#2d2a3a] hover:bg-[#252230] hover:border-[#433e54]"
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
