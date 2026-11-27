"use client";

import { useMemo } from "react";
import Link from "next/link";
import { RefreshCw, Clock } from "lucide-react";
import {
  DonutChart,
  DonutChartCenter,
  DonutChartLegend,
  DonutChartPlot,
  type DonutSegment,
} from "@/components/charts/donut-chart";
import { useActiveMember, useActiveOrganization } from "@/lib/auth-client";
import { useResource } from "@/lib/resource";
import { getOrganizationUsage, type ServiceUsageSummary } from "@/lib/usage-client";
import { formatDateTime } from "@/lib/format";

function formatMb(mb: number): string {
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function calculatePercent(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(Math.round((used / limit) * 100), 100);
}

function quotaTone(used: number, limit: number): "is-healthy" | "is-pending" | "is-failed" {
  if (limit > 0 && used >= limit) return "is-failed";
  if (limit > 0 && used / limit >= 0.8) return "is-pending";
  return "is-healthy";
}

function QuotaMeter({
  label,
  used,
  limit,
  description,
}: {
  label: string;
  used: number;
  limit: number;
  description?: string;
}) {
  const percent = calculatePercent(used, limit);
  const atLimit = limit > 0 && used >= limit;
  const nearLimit = limit > 0 && percent >= 80 && !atLimit;
  const tone = atLimit ? "is-failed" : nearLimit ? "is-pending" : "is-healthy";

  return (
    <div className="usage-meter-row">
      <div className="flex items-baseline gap-[10px] mb-[6px]">
        <span className="text-[12px] font-medium text-ink-console">{label}</span>
        <span className="usage-meter-numbers">
          {used} <span>/ {limit}</span>
        </span>
        <span className={`usage-meter-percent ${tone}`}>{percent}%</span>
      </div>
      <div
        className="usage-progress-track"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} usage`}
      >
        <div className={`usage-progress-fill ${tone}`} style={{ width: `${percent}%` }} />
      </div>
      {description ? <p className="mt-[6px] mb-0 mx-0 text-[11px] text-ink-muted">{description}</p> : null}
    </div>
  );
}

export default function UsagePage() {
  const { data: organization } = useActiveOrganization();
  const { data: activeMember } = useActiveMember();
  const organizationId = organization?.id;
  // Better Auth stores multiple roles as a comma-separated string, so check the
  // parsed set rather than the raw value.
  const canSeeLimitDetail =
    activeMember?.role
      .split(",")
      .some((role) => role.trim() === "owner" || role.trim() === "admin") ?? false;

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

  const quotaChecks = usageData
    ? [
        { used: usageData.counts.projects.used, limit: usageData.counts.projects.limit },
        { used: usageData.counts.services.used, limit: usageData.counts.services.limit },
        { used: maxServicesPerProject, limit: usageData.limits.servicesPerProject },
        { used: maxDatabasesPerProject, limit: usageData.limits.databasesPerProject },
      ]
    : [];
  const quotaAttention = quotaChecks.filter(
    (quota) => quota.limit > 0 && quota.used / quota.limit >= 0.8,
  ).length;
  const serviceQuotaTone = usageData
    ? quotaTone(usageData.counts.services.used, usageData.counts.services.limit)
    : "is-healthy";

  // Status shares come straight from the measured services, not a demo fixture.
  const statusSegments: DonutSegment[] = usageData
    ? [
        { id: "running", name: "Running", color: "#3ecf8e", value: 0 },
        { id: "deploying", name: "Deploying", color: "#fbbf24", value: 0 },
        { id: "stopped", name: "Stopped", color: "#a1a1aa", value: 0 },
        { id: "failed", name: "Failed", color: "#f43f5e", value: 0 },
        { id: "other", name: "Other", color: "#818cf8", value: 0 },
      ].map((segment) => {
        const value = usageData.services.filter((service) => {
          if (segment.id === "other") {
            return !["running", "deploying", "stopped", "failed"].includes(service.status);
          }
          return service.status === segment.id;
        }).length;
        return { ...segment, value };
      })
    : [];

  const serviceGroups = useMemo(() => {
    const byProject = new Map<string, { name: string; items: ServiceUsageSummary[] }>();
    for (const service of usageData?.services ?? []) {
      const group = byProject.get(service.projectId) ?? { name: service.projectName, items: [] };
      group.items.push(service);
      byProject.set(service.projectId, group);
    }
    return Array.from(byProject, ([id, value]) => ({ id, ...value }));
  }, [usageData]);

  return (
    <div className="usage-page-container">
      <header className="flex items-end justify-between flex-wrap gap-[16px] mb-[18px]">
        <div className="min-w-0">
          <h1 className="text-[20px]! font-semibold! text-ink tracking-[-0.015em]! m-0">Usage &amp; Quotas</h1>
          <p className="text-[13px] text-ink-muted mt-[4px] leading-[1.4]">
            Measured resources and limits for {organization?.name ?? "your organization"}.
          </p>
        </div>
        <button
          type="button"
          className="supabase-btn-secondary"
          onClick={() => void usage.refresh()}
          disabled={loading}
          aria-busy={loading}
        >
          <RefreshCw
            className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <span>Refresh</span>
        </button>
      </header>

      {usageData ? (
        <div className={`usage-status-line ${quotaAttention ? "is-attention" : "is-healthy"}`}>
          <span className="project-status-dot" aria-hidden="true" />
          <span>
            {quotaAttention === 0
              ? "All quotas within limits"
              : `${quotaAttention} ${quotaAttention === 1 ? "quota is" : "quotas are"} near or at limit`}
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="dashboard-alert is-error mb-[16px]" role="alert">
          {error}
        </div>
      ) : null}

      {loading && !usageData ? (
        <div className="py-[16px] px-0" role="status" aria-label="Loading usage data">
          <div className="supabase-skeleton-box h-3 w-64 rounded mb-3" />
          <div className="supabase-skeleton-box h-7 w-48 rounded" />
        </div>
      ) : !usageData ? (
        <div className="py-[48px] px-[20px] text-center border border-dashed border-[#2a2833] rounded-card">
          <h2 className="usage-empty-title">Quota unavailable</h2>
          <p className="usage-empty-copy">
            The organization quota could not be loaded. Try refreshing.
          </p>
        </div>
      ) : (
        <>
          <section className="usage-totals" aria-label="Measured resource totals">
            <div>
              <span>CPU</span>
              <strong>{usageData.totals.cpu.toFixed(2)} vCPU</strong>
            </div>
            <div>
              <span>Memory</span>
              <strong>{formatMb(usageData.totals.memoryMb)}</strong>
            </div>
            <div>
              <span>Volume</span>
              <strong>{formatMb(usageData.totals.volumeMb)}</strong>
            </div>
            <div>
              <span>Database</span>
              <strong>{formatMb(usageData.totals.databaseMb)}</strong>
            </div>
          </section>

          <section className="usage-section" aria-labelledby="quotas-section-heading">
            <div className="usage-section-head">
              <h2 id="quotas-section-heading">Capacity &amp; quotas</h2>
              <span>Platform limits</span>
            </div>
            <div className="usage-capacity">
              <div className="usage-capacity-primary">
                <span className="text-[11px] uppercase tracking-[0.04em] text-ink-muted">Services in this organization</span>
                <div className="usage-capacity-value">
                  <strong>{usageData.counts.services.used}</strong>
                  <span>/ {usageData.counts.services.limit}</span>
                </div>
                <div
                  className="usage-progress-track"
                  role="progressbar"
                  aria-valuenow={calculatePercent(
                    usageData.counts.services.used,
                    usageData.counts.services.limit,
                  )}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Service quota usage"
                >
                  <div
                    className={`usage-progress-fill ${serviceQuotaTone}`}
                    style={{
                      width: `${calculatePercent(usageData.counts.services.used, usageData.counts.services.limit)}%`,
                    }}
                  />
                </div>
                <p>Docker services currently running in this organization.</p>
              </div>
              <div className="flex flex-col justify-center gap-[14px] min-w-0">
                <QuotaMeter
                  label="Projects"
                  used={usageData.counts.projects.used}
                  limit={usageData.counts.projects.limit}
                  description="Isolated project workspaces"
                />
                <QuotaMeter
                  label="Services in busiest project"
                  used={maxServicesPerProject}
                  limit={usageData.limits.servicesPerProject}
                  description="Maximum services inside one project"
                />
                <QuotaMeter
                  label="Databases in busiest project"
                  used={maxDatabasesPerProject}
                  limit={usageData.limits.databasesPerProject}
                  description="Maximum databases inside one project"
                />
              </div>
            </div>
          </section>

          <section className="usage-section" aria-labelledby="service-health-heading">
            <div className="usage-section-head">
              <h2 id="service-health-heading">Service status</h2>
              <span>{usageData.services.length} services</span>
            </div>
            {statusSegments.some((segment) => segment.value > 0) ? (
              <div className="usage-health-card py-[16px] px-[18px] border border-surface-raised rounded-card">
                <DonutChart
                  segments={statusSegments}
                  label="Service status distribution"
                  formatValue={(value) => `${value} services`}
                >
                  <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,14rem)_1fr]">
                    <DonutChartPlot>
                      <DonutChartCenter totalLabel="Services" />
                    </DonutChartPlot>
                    <DonutChartLegend />
                  </div>
                </DonutChart>
              </div>
            ) : (
              <div className="usage-empty-box">
                <p className="usage-empty-title">No services to measure yet</p>
                <p className="usage-empty-copy">
                  Deploy a service from a project. Its CPU, memory, storage and status will appear
                  here automatically.
                </p>
                <Link href="/dashboard/projects" className="usage-group-link">
                  Go to Projects
                </Link>
              </div>
            )}
          </section>

          <section className="usage-section" aria-labelledby="projects-usage-heading">
            <div className="usage-section-head">
              <h2 id="projects-usage-heading">Projects at a glance</h2>
              <span>{usageData.projects.length} projects</span>
            </div>
            <div className="usage-project-list border border-surface-raised rounded-card overflow-hidden">
              {usageData.projects.map((project) => (
                <div key={project.id} className="usage-project-row">
                  <Link href={`/dashboard/projects/${project.id}`} className="usage-row-name">
                    {project.name}
                  </Link>
                  <div className="usage-project-metric">
                    <span>
                      Services {project.serviceCount}/{project.serviceLimit}
                    </span>
                    <div className="usage-mini-track" aria-hidden="true">
                      <div
                        style={{
                          width: `${calculatePercent(project.serviceCount, project.serviceLimit)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="usage-project-metric">
                    <span>
                      Databases {project.databaseCount}/{project.databaseLimit}
                    </span>
                    <div className="usage-mini-track" aria-hidden="true">
                      <div
                        style={{
                          width: `${calculatePercent(project.databaseCount, project.databaseLimit)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="usage-section" aria-labelledby="services-usage-heading">
            <div className="usage-section-head">
              <h2 id="services-usage-heading">Service resource breakdown</h2>
              <span>{usageData.services.length} services</span>
            </div>
            <p className="usage-section-intro">
              Measured CPU, memory and disk for each deployed container, grouped by project.
            </p>
            <div className="usage-table-card">
              {usageData.services.length === 0 ? (
                <div className="usage-empty-box">
                  <p className="usage-empty-title">No deployed services</p>
                  <p className="usage-empty-copy">
                    Deploy a service from a project to start measuring container compute and memory.
                  </p>
                </div>
              ) : (
                <table className="usage-table">
                  <thead>
                    <tr>
                      <th scope="col">Service</th>
                      <th scope="col">CPU</th>
                      <th scope="col">Memory</th>
                      <th scope="col">Volume</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  {serviceGroups.map((group) => (
                    <tbody key={group.id}>
                      <tr className="usage-group-row">
                        <th colSpan={5} scope="rowgroup">
                          <span className="text-[12px] font-semibold text-ink-console">{group.name}</span>
                          <span className="ml-[8px] text-[11px] [font-family:var(--font-console-mono)] text-ink-muted">{group.items.length}</span>
                          <Link
                            href={`/dashboard/projects/${group.id}`}
                            className="usage-group-link"
                          >
                            Open project
                          </Link>
                        </th>
                      </tr>
                      {group.items.map((service) => (
                        <tr key={service.id}>
                          <td>
                            <Link
                              href={`/dashboard/services/${service.id}`}
                              className="usage-row-name"
                            >
                              {service.name}
                            </Link>
                          </td>
                          <td className="usage-number">
                            {service.cpuUsage.toFixed(2)}
                            {canSeeLimitDetail ? (
                              <span> / {service.cpuLimit} vCPU</span>
                            ) : (
                              <span> vCPU</span>
                            )}
                          </td>
                          <td className="usage-number">
                            {formatMb(service.memoryUsageMb)}
                            {canSeeLimitDetail ? (
                              <span> / {formatMb(service.memoryLimitMb)}</span>
                            ) : null}
                          </td>
                          <td className="usage-number">
                            {formatMb(service.volumeUsageMb)}
                            {canSeeLimitDetail ? (
                              <span> / {formatMb(service.volumeLimitMb)}</span>
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
                              <span>{service.status.replace("_", " ")}</span>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              )}
            </div>
          </section>

          {usageData.databases.length > 0 ? (
            <section className="usage-section" aria-labelledby="databases-usage-heading">
              <div className="usage-section-head">
                <h2 id="databases-usage-heading">Database storage</h2>
                <span>{usageData.databases.length} databases</span>
              </div>
              <p className="usage-section-intro">
                Measured storage used by each database in this organization.
              </p>
              <div className="usage-table-card">
                <table className="usage-table">
                  <thead>
                    <tr>
                      <th scope="col">Database</th>
                      <th scope="col">Project</th>
                      <th scope="col">Measured storage</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageData.databases.map((database) => (
                      <tr key={database.id}>
                        <td className="usage-row-name">
                          {database.engine === "mysql" ? "MySQL" : "PostgreSQL"} {database.version}
                        </td>
                        <td>
                          <Link
                            href={`/dashboard/projects/${database.projectId}`}
                            className="usage-subtle-link text-[12px]"
                          >
                            {database.projectName}
                          </Link>
                        </td>
                        <td className="usage-number">
                          {formatMb(database.usageMb)}
                          {canSeeLimitDetail ? (
                            <span> / {formatMb(database.storageLimitMb)}</span>
                          ) : null}
                        </td>
                        <td>
                          <span
                            className={`usage-status-pill ${
                              database.overQuota ? "is-failed" : "is-running"
                            }`}
                          >
                            <span className="project-status-dot" aria-hidden="true" />
                            <span>{database.overQuota ? "Over quota" : database.status}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {canSeeLimitDetail ? (
            <section className="usage-section" aria-labelledby="limit-detail-heading">
              <div className="usage-section-head">
                <h2 id="limit-detail-heading">Platform allocation policy</h2>
              </div>
              <div className="usage-policy-card border border-surface-raised rounded-card overflow-hidden">
                <div className="usage-policy-grid">
                  <div>
                    <span>CPU cap per service</span>
                    <strong>{usageData.limits.cpuPerService} vCPU</strong>
                  </div>
                  <div>
                    <span>Memory cap per service</span>
                    <strong>{formatMb(usageData.limits.memoryMbPerService)}</strong>
                  </div>
                  <div>
                    <span>Volume cap per service</span>
                    <strong>{formatMb(usageData.limits.volumeMbPerService)}</strong>
                  </div>
                  <div>
                    <span>Database storage cap</span>
                    <strong>{formatMb(usageData.limits.databaseStorageMb)}</strong>
                  </div>
                  <div>
                    <span>Build concurrency</span>
                    <strong>{usageData.limits.buildConcurrencyPerNode} jobs / node</strong>
                  </div>
                  <div>
                    <span>Log retention</span>
                    <strong>{usageData.limits.logRetentionDays} days</strong>
                  </div>
                </div>
                <div className="usage-policy-footer py-[12px] px-[18px] border-t border-t-surface-raised text-[12px] text-ink-muted">
                  Values above are the platform limits applied to this organization.
                </div>
              </div>
            </section>
          ) : null}

          {usageData.capturedAt ? (
            <p className="flex items-center gap-[7px] mt-[4px] mb-[24px] mx-0 text-[12px] text-ink-muted">
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              Last measured {formatDateTime(usageData.capturedAt)}.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
