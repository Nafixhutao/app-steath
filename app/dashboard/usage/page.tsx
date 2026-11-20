"use client";

import Link from "next/link";
import {
  Gauge,
  Cpu,
  Activity,
  HardDrive,
  Database,
  Layers,
  RefreshCw,
  ExternalLink,
  ShieldAlert,
  Server,
  Clock,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useActiveMember, useActiveOrganization } from "@/lib/auth-client";
import { useResource } from "@/lib/resource";
import { getOrganizationUsage } from "@/lib/usage-client";
import { formatDateTime } from "@/lib/format";
import { useGsapEntrance } from "@/lib/animation/use-gsap-entrance";

function formatMb(mb: number): string {
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function calculatePercent(used: number, limit: number): number {
  if (limit <= 0) return 0;
  const pct = Math.round((used / limit) * 100);
  return Math.min(pct, 100);
}

function QuotaMeter({
  label,
  used,
  limit,
  unit = "",
  description,
}: {
  label: string;
  used: number;
  limit: number;
  unit?: string;
  description?: string;
}) {
  const percent = calculatePercent(used, limit);
  const atLimit = limit > 0 && used >= limit;
  const nearLimit = limit > 0 && percent >= 80 && !atLimit;

  return (
    <div className="usage-meter-card">
      <div className="flex items-center justify-between mb-2">
        <span className="usage-meter-label">{label}</span>
        <span
          className={`usage-meter-pill ${
            atLimit ? "is-failed" : nearLimit ? "is-pending" : "is-healthy"
          }`}
        >
          {atLimit ? "At Limit" : nearLimit ? "Near Limit" : "Within Quota"}
        </span>
      </div>

      <div className="flex items-baseline justify-between mb-2">
        <span className="usage-meter-numbers">
          <strong>
            {used}
            {unit}
          </strong>{" "}
          <span className="text-zinc-400">
            of {limit}
            {unit}
          </span>
        </span>
        <span className="text-xs font-mono font-medium text-zinc-300 tabular-nums">{percent}%</span>
      </div>

      <div
        className="usage-progress-track"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} usage`}
      >
        <div
          className={`usage-progress-fill ${
            atLimit ? "is-failed" : nearLimit ? "is-pending" : "is-healthy"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {description ? <p className="text-[11px] text-zinc-400 mt-2">{description}</p> : null}
    </div>
  );
}

export default function UsagePage() {
  const { data: organization } = useActiveOrganization();
  const { data: activeMember } = useActiveMember();
  const organizationId = organization?.id;
  const canSeeLimitDetail = activeMember?.role === "owner" || activeMember?.role === "admin";

  const usage = useResource(() => getOrganizationUsage(), [organizationId], {
    enabled: Boolean(organizationId),
  });
  const usageData = usage.data;
  const loading = usage.loading;
  const error = usage.error;

  const maxServicesPerProject =
    usageData?.projects.reduce((max, project) => Math.max(max, project.serviceCount), 0) ?? 0;
  const maxDatabasesPerProject =
    usageData?.projects.reduce((max, project) => Math.max(max, project.databaseCount), 0) ?? 0;

  const containerRef = useGsapEntrance<HTMLDivElement>(
    [
      { targets: ".usage-metric-card", y: 10, duration: 0.35, stagger: 0.05 },
      { targets: ".usage-meter-card", y: 10, duration: 0.35, stagger: 0.05, delay: 0.08 },
      { targets: ".usage-table-card, .usage-policy-card", y: 12, duration: 0.4, delay: 0.16 },
    ],
    [Boolean(usageData)],
  );

  return (
    <div ref={containerRef} className="usage-page-container">
      {/* Header */}
      <header className="usage-page-header">
        <div className="flex items-center gap-3">
          <div className="usage-header-icon" aria-hidden="true">
            <Gauge className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="usage-page-title">Usage &amp; Quotas</h1>
              <span className="supabase-plan-badge">FREE PLAN</span>
            </div>
            <p className="usage-page-subtitle">
              Resource consumption, billing quotas, and system limits for{" "}
              {organization?.name ?? "your organization"}.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="supabase-btn-secondary"
          onClick={() => void usage.refresh()}
          disabled={loading}
          aria-busy={loading}
          title="Refresh measured usage"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </header>

      {error ? (
        <div className="dashboard-alert is-error my-4" role="alert">
          {error}
        </div>
      ) : null}

      {loading && !usageData ? (
        <div className="p-8 space-y-4" aria-label="Loading usage data">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="usage-metric-skeleton">
                <div className="supabase-skeleton-box h-4 w-24 rounded" />
                <div className="supabase-skeleton-box h-7 w-20 rounded mt-2" />
                <div className="supabase-skeleton-box h-3 w-32 rounded mt-2" />
              </div>
            ))}
          </div>
        </div>
      ) : !usageData ? (
        <div className="usage-empty-state">
          <AlertCircle className="w-8 h-8 text-zinc-400 mb-2" />
          <h2 className="text-sm font-semibold text-white">Quota unavailable</h2>
          <p className="text-xs text-zinc-400 mt-1">
            The organization quota could not be loaded. Try refreshing in a moment.
          </p>
        </div>
      ) : (
        <>
          {/* Top 4 Metrics Grid */}
          <section
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6"
            aria-label="Measured resource totals"
          >
            <div className="usage-metric-card">
              <div className="flex items-center justify-between">
                <span className="usage-metric-label">CPU Consumption</span>
                <div className="usage-metric-icon-badge is-emerald">
                  <Cpu className="w-4 h-4" />
                </div>
              </div>
              <span className="usage-metric-val">
                {usageData.totals.cpu.toFixed(2)}{" "}
                <small className="text-xs font-normal text-zinc-400">vCPU</small>
              </span>
              <span className="text-[11px] text-zinc-400">Active container cores</span>
            </div>

            <div className="usage-metric-card">
              <div className="flex items-center justify-between">
                <span className="usage-metric-label">RAM Consumed</span>
                <div className="usage-metric-icon-badge is-cyan">
                  <Activity className="w-4 h-4" />
                </div>
              </div>
              <span className="usage-metric-val">{formatMb(usageData.totals.memoryMb)}</span>
              <span className="text-[11px] text-zinc-400">Container memory footprint</span>
            </div>

            <div className="usage-metric-card">
              <div className="flex items-center justify-between">
                <span className="usage-metric-label">Volume Storage</span>
                <div className="usage-metric-icon-badge is-amber">
                  <HardDrive className="w-4 h-4" />
                </div>
              </div>
              <span className="usage-metric-val">{formatMb(usageData.totals.volumeMb)}</span>
              <span className="text-[11px] text-zinc-400">Persistent mounted disks</span>
            </div>

            <div className="usage-metric-card">
              <div className="flex items-center justify-between">
                <span className="usage-metric-label">Database Storage</span>
                <div className="usage-metric-icon-badge is-blue">
                  <Database className="w-4 h-4" />
                </div>
              </div>
              <span className="usage-metric-val">{formatMb(usageData.totals.databaseMb)}</span>
              <span className="text-[11px] text-zinc-400">Managed PostgreSQL engines</span>
            </div>
          </section>

          {/* Quotas & Capacity Section */}
          <section className="mb-8" aria-labelledby="quotas-section-heading">
            <div className="flex items-center justify-between mb-3.5">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                <h2 id="quotas-section-heading" className="text-sm font-semibold text-white">
                  Organization Quotas &amp; Limits
                </h2>
              </div>
              <span className="text-xs text-zinc-400">Updated automatically</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <QuotaMeter
                label="Projects"
                used={usageData.counts.projects.used}
                limit={usageData.counts.projects.limit}
                description="Total isolated project workspaces"
              />
              <QuotaMeter
                label="Total Services"
                used={usageData.counts.services.used}
                limit={usageData.counts.services.limit}
                description="Deployed Docker services in organization"
              />
              <QuotaMeter
                label="Services (Busiest Project)"
                used={maxServicesPerProject}
                limit={usageData.limits.servicesPerProject}
                description="Max services allowed within 1 project"
              />
              <QuotaMeter
                label="Databases (Busiest Project)"
                used={maxDatabasesPerProject}
                limit={usageData.limits.databasesPerProject}
                description="Max Postgres instances within 1 project"
              />
            </div>
          </section>

          {/* Measured Services Table */}
          <section className="mb-8" aria-labelledby="services-usage-heading">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-emerald-400" />
                <h2 id="services-usage-heading" className="text-sm font-semibold text-white">
                  Active Services Resource Breakdown
                </h2>
              </div>
              <span className="usage-count-pill">{usageData.services.length} Services</span>
            </div>

            <div className="usage-table-card">
              {usageData.services.length === 0 ? (
                <div className="usage-empty-box">
                  <Server className="w-7 h-7 text-zinc-600 mb-2" />
                  <p className="text-sm text-zinc-300 font-medium">No deployed services</p>
                  <p className="text-xs text-zinc-400 mt-1">
                    Deploy a service from a project to start measuring container compute and RAM.
                  </p>
                </div>
              ) : (
                <table className="usage-table">
                  <thead>
                    <tr>
                      <th scope="col">Service</th>
                      <th scope="col">Project</th>
                      <th scope="col">CPU</th>
                      <th scope="col">Memory (RAM)</th>
                      <th scope="col">Volume Disk</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageData.services.map((service) => (
                      <tr key={service.id}>
                        <td>
                          <Link
                            href={`/dashboard/services/${service.id}`}
                            className="group font-medium text-white hover:text-emerald-400 transition-colors inline-flex items-center gap-1.5"
                          >
                            <span>{service.name}</span>
                            <ExternalLink className="w-3 h-3 text-zinc-400 opacity-70 group-hover:opacity-100 transition-opacity" />
                          </Link>
                        </td>
                        <td>
                          <Link
                            href={`/dashboard/projects/${service.projectId}`}
                            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                          >
                            {service.projectName}
                          </Link>
                        </td>
                        <td className="text-xs font-mono tabular-nums text-zinc-200">
                          {service.cpuUsage.toFixed(2)}
                          {canSeeLimitDetail ? (
                            <span className="text-zinc-400"> / {service.cpuLimit} vCPU</span>
                          ) : (
                            " vCPU"
                          )}
                        </td>
                        <td className="text-xs font-mono tabular-nums text-zinc-200">
                          {formatMb(service.memoryUsageMb)}
                          {canSeeLimitDetail ? (
                            <span className="text-zinc-400">
                              {" "}
                              / {formatMb(service.memoryLimitMb)}
                            </span>
                          ) : null}
                        </td>
                        <td className="text-xs font-mono tabular-nums text-zinc-200">
                          {formatMb(service.volumeUsageMb)}
                          {canSeeLimitDetail ? (
                            <span className="text-zinc-400">
                              {" "}
                              / {formatMb(service.volumeLimitMb)}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <span
                            className={`usage-status-pill ${
                              service.status === "running"
                                ? "is-running"
                                : service.status === "failed"
                                  ? "is-failed"
                                  : "is-pending"
                            }`}
                          >
                            <span className="project-status-dot" aria-hidden="true" />
                            <span className="capitalize">{service.status}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* Measured Databases Table (if any) */}
          {usageData.databases.length > 0 && (
            <section className="mb-8" aria-labelledby="databases-usage-heading">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-blue-400" />
                  <h2 id="databases-usage-heading" className="text-sm font-semibold text-white">
                    PostgreSQL Database Storage
                  </h2>
                </div>
                <span className="usage-count-pill">{usageData.databases.length} Databases</span>
              </div>

              <div className="usage-table-card">
                <table className="usage-table">
                  <thead>
                    <tr>
                      <th scope="col">Database</th>
                      <th scope="col">Project</th>
                      <th scope="col">Measured Storage</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageData.databases.map((database) => (
                      <tr key={database.id}>
                        <td>
                          <div className="flex items-center gap-2">
                            <Database className="w-3.5 h-3.5 text-blue-400" />
                            <span className="font-medium text-white text-xs">PostgreSQL 16</span>
                          </div>
                        </td>
                        <td>
                          <Link
                            href={`/dashboard/projects/${database.projectId}`}
                            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                          >
                            {database.projectName}
                          </Link>
                        </td>
                        <td className="text-xs font-mono tabular-nums text-zinc-200">
                          {formatMb(database.usageMb)}
                          {canSeeLimitDetail ? (
                            <span className="text-zinc-400">
                              {" "}
                              / {formatMb(database.storageLimitMb)}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <span
                            className={`usage-status-pill ${
                              database.overQuota ? "is-failed" : "is-running"
                            }`}
                          >
                            <span className="project-status-dot" aria-hidden="true" />
                            <span>{database.overQuota ? "Over Quota" : database.status}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Detailed Platform Constraints & Policy */}
          {canSeeLimitDetail ? (
            <section className="mb-8" aria-labelledby="limit-detail-heading">
              <div className="flex items-center gap-2 mb-3">
                <ShieldAlert className="w-4 h-4 text-emerald-400" />
                <h2 id="limit-detail-heading" className="text-sm font-semibold text-white">
                  Platform Allocation Policy
                </h2>
              </div>

              <div className="usage-policy-card">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-4 gap-x-6 p-5">
                  <div className="space-y-1">
                    <span className="text-xs text-zinc-400 font-medium">CPU Cap per Service</span>
                    <p className="text-sm font-mono font-medium text-white tabular-nums">
                      {usageData.limits.cpuPerService} vCPU
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs text-zinc-400 font-medium">RAM Cap per Service</span>
                    <p className="text-sm font-mono font-medium text-white tabular-nums">
                      {formatMb(usageData.limits.memoryMbPerService)}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs text-zinc-400 font-medium">
                      Volume Cap per Service
                    </span>
                    <p className="text-sm font-mono font-medium text-white tabular-nums">
                      {formatMb(usageData.limits.volumeMbPerService)}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs text-zinc-400 font-medium">Database Storage Cap</span>
                    <p className="text-sm font-mono font-medium text-white tabular-nums">
                      {formatMb(usageData.limits.databaseStorageMb)}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs text-zinc-400 font-medium">Build Concurrency</span>
                    <p className="text-sm font-mono font-medium text-white tabular-nums">
                      {usageData.limits.buildConcurrencyPerNode} simultaneous jobs / node
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs text-zinc-400 font-medium">Log Retention</span>
                    <p className="text-sm font-mono font-medium text-white tabular-nums">
                      {usageData.limits.logRetentionDays} days automatic prune
                    </p>
                  </div>
                </div>

                <div className="usage-policy-footer">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <p className="text-xs text-zinc-400">
                    Lowering a quota never deletes an existing resource. All services and databases
                    continue running until an owner or admin deletes them.
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {/* Footer timestamp */}
          {usageData.capturedAt ? (
            <div className="flex items-center gap-1.5 text-xs text-zinc-400 pt-2 pb-6">
              <Clock className="w-3.5 h-3.5" />
              <span>
                Last measured {formatDateTime(usageData.capturedAt)}. System metrics refresh every 5
                minutes.
              </span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
