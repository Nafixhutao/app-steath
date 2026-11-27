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

const TONE_TEXT = {
  "is-healthy": "",
  "is-pending": "text-[var(--color-warning)]",
  "is-failed": "text-[#fda4af]",
} as const;

const TONE_FILL = {
  "is-healthy": "",
  "is-pending": "bg-[var(--color-warning)]",
  "is-failed": "bg-[var(--color-danger)]",
} as const;

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
    <div className="min-w-0">
      <div className="flex items-baseline gap-[10px] mb-[6px]">
        <span className="text-[12px] font-medium text-ink-console">{label}</span>
        <span className="usage-meter-numbers ml-[auto] [font-family:var(--font-console-mono)] text-[12px] tabular-nums text-ink-bright [&_span]:text-[var(--color-ink-muted)]">
          {used} <span>/ {limit}</span>
        </span>
        <span className={`usage-meter-percent [font-family:var(--font-console-mono)] text-[12px] tabular-nums text-ink-bright min-w-[36px] text-ink-muted text-right ${TONE_TEXT[tone]}`}>{percent}%</span>
      </div>
      <div
        className="bg-[#1a1922] h-[6px] w-full rounded-[9999px] overflow-hidden"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} usage`}
      >
        <div className={`usage-progress-fill h-full rounded-[9999px] bg-accent ${TONE_FILL[tone]}`} style={{ width: `${percent}%` }} />
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
    <div className="usage-page-container [@media(max-width:720px)]:pt-[20px] [@media(max-width:720px)]:pb-[48px] [@media(max-width:720px)]:px-[16px] pt-[24px] pb-[56px] px-[32px] max-w-[1280px] my-0 mx-auto w-full">
      <header className="flex items-end justify-between flex-wrap gap-[16px] mb-[18px]">
        <div className="min-w-0">
          <h1 className="text-[20px]! font-semibold! text-ink tracking-[-0.015em]! m-0">Usage &amp; Quotas</h1>
          <p className="text-[13px] text-ink-muted mt-[4px] leading-[1.4]">
            Measured resources and limits for {organization?.name ?? "your organization"}.
          </p>
        </div>
        <button
          type="button"
          className="supabase-btn-secondary font-medium focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] inline-flex items-center justify-center min-h-[38px] rounded-card border border-[#2a2834] bg-[#181720] [box-shadow:0_1px_2px_rgba(0,0,0,0.2)] whitespace-nowrap no-underline [transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease,color_120ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:border-[#3b3749] [&:hover:not(:disabled)]:bg-[#201e2a] [&:active:not(:disabled)]:translate-y-[1px] disabled:opacity-[0.5] disabled:transform-none"
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
        <div className={`usage-status-line inline-flex items-center gap-[8px] mb-[18px] text-[12px] text-ink-muted ${quotaAttention ? "text-[var(--color-warning)] [&_.project-status-dot]:bg-[var(--color-warning)]" : "[&_.project-status-dot]:bg-[var(--color-accent)]"}`}>
          <span className="project-status-dot bg-current w-[6px] h-[6px] rounded-[50%]" aria-hidden="true" />
          <span>
            {quotaAttention === 0
              ? "All quotas within limits"
              : `${quotaAttention} ${quotaAttention === 1 ? "quota is" : "quotas are"} near or at limit`}
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error mb-[16px]" role="alert">
          {error}
        </div>
      ) : null}

      {loading && !usageData ? (
        <div className="py-[16px] px-0" role="status" aria-label="Loading usage data">
          <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-3 w-64 rounded mb-3" />
          <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-7 w-48 rounded" />
        </div>
      ) : !usageData ? (
        <div className="py-[48px] px-[20px] text-center border border-dashed border-[#2a2833] rounded-card">
          <h2 className="text-[14px] font-semibold text-ink-bright mt-0 mb-[6px] mx-0">Quota unavailable</h2>
          <p className="max-w-[460px] my-0 mx-auto text-[12px] leading-[1.5] text-ink-muted">
            The organization quota could not be loaded. Try refreshing.
          </p>
        </div>
      ) : (
        <>
          <section className="usage-totals flex items-center flex-wrap gap-[12px_0] py-[12px] px-0 mb-[24px] border-t border-t-surface-raised border-b border-b-surface-raised [&>div]:flex [&>div]:items-baseline [&>div]:gap-[8px] [&>div]:px-[20px] [&>div]:py-0 [&>div]:border-r [&>div]:border-[var(--color-surface-raised)] [&>div:first-child]:pl-0 [&>div:last-child]:border-r-0 [@media(max-width:720px)]:[&>div]:px-[12px] [&_span]:text-[12px] [&_span]:text-[var(--color-ink-muted)] [&_strong]:text-[18px] [&_strong]:font-semibold [&_strong]:text-[var(--color-ink-bright)] [&_strong]:[font-family:var(--font-console-mono)] [&_strong]:tabular-nums" aria-label="Measured resource totals">
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

          <section className="mb-[26px]" aria-labelledby="quotas-section-heading">
            <div className="usage-section-head flex items-baseline justify-between gap-[12px] mb-[10px] [&_h2]:m-0 [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:text-[var(--color-ink-console)] [&_span]:text-[11px] [&_span]:text-[var(--color-ink-muted)] [&_span]:whitespace-nowrap">
              <h2 id="quotas-section-heading">Capacity &amp; quotas</h2>
              <span>Platform limits</span>
            </div>
            <div className="usage-capacity bg-surface grid gap-[16px] p-[18px] border border-surface-raised rounded-card grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] [@media(max-width:860px)]:grid-cols-1">
              <div className="usage-capacity-primary [@media(max-width:860px)]:pr-[0] [@media(max-width:860px)]:pb-[14px] [@media(max-width:860px)]:border-b [@media(max-width:860px)]:border-b-surface-raised flex flex-col justify-center min-w-0 pr-[20px] border-r border-r-[var(--color-surface-raised)] [@media(max-width:860px)]:border-r-0 [&>p]:mt-[10px] [&>p]:mb-0 [&>p]:mx-0 [&>p]:text-[11px] [&>p]:text-[var(--color-ink-muted)]">
                <span className="text-[11px] uppercase tracking-[0.04em] text-ink-muted">Services in this organization</span>
                <div className="usage-capacity-value flex items-baseline gap-[6px] mt-[4px] mb-[12px] mx-0 [&_strong]:text-[30px] [&_strong]:font-semibold [&_strong]:leading-none [&_strong]:text-[var(--color-ink-bright)] [&_strong]:[font-family:var(--font-console-mono)] [&_strong]:tabular-nums [&_span]:text-[13px] [&_span]:text-[var(--color-ink-muted)] [&_span]:[font-family:var(--font-console-mono)]">
                  <strong>{usageData.counts.services.used}</strong>
                  <span>/ {usageData.counts.services.limit}</span>
                </div>
                <div
                  className="bg-[#1a1922] h-[6px] w-full rounded-[9999px] overflow-hidden"
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
                    className={`usage-progress-fill h-full rounded-[9999px] bg-accent ${TONE_FILL[serviceQuotaTone]}`}
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

          <section className="mb-[26px]" aria-labelledby="service-health-heading">
            <div className="usage-section-head flex items-baseline justify-between gap-[12px] mb-[10px] [&_h2]:m-0 [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:text-[var(--color-ink-console)] [&_span]:text-[11px] [&_span]:text-[var(--color-ink-muted)] [&_span]:whitespace-nowrap">
              <h2 id="service-health-heading">Service status</h2>
              <span>{usageData.services.length} services</span>
            </div>
            {statusSegments.some((segment) => segment.value > 0) ? (
              <div className="bg-surface py-[16px] px-[18px] border border-surface-raised rounded-card">
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
              <div className="py-[40px] px-[20px] text-center">
                <p className="text-[14px] font-semibold text-ink-bright mt-0 mb-[6px] mx-0">No services to measure yet</p>
                <p className="max-w-[460px] my-0 mx-auto text-[12px] leading-[1.5] text-ink-muted">
                  Deploy a service from a project. Its CPU, memory, storage and status will appear
                  here automatically.
                </p>
                <Link href="/dashboard/projects" className="text-accent hover:text-[#6ee7b7] ml-[12px] text-[11px]">
                  Go to Projects
                </Link>
              </div>
            )}
          </section>

          <section className="mb-[26px]" aria-labelledby="projects-usage-heading">
            <div className="usage-section-head flex items-baseline justify-between gap-[12px] mb-[10px] [&_h2]:m-0 [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:text-[var(--color-ink-console)] [&_span]:text-[11px] [&_span]:text-[var(--color-ink-muted)] [&_span]:whitespace-nowrap">
              <h2 id="projects-usage-heading">Projects at a glance</h2>
              <span>{usageData.projects.length} projects</span>
            </div>
            <div className="bg-surface border border-surface-raised rounded-card overflow-hidden">
              {usageData.projects.map((project) => (
                <div key={project.id} className="usage-project-row [@media(max-width:720px)]:gap-[8px] grid items-center gap-[20px] py-[11px] px-[16px] border-b border-b-[#1f1d25] last:border-b-0 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] [@media(max-width:720px)]:grid-cols-1">
                  <Link href={`/dashboard/projects/${project.id}`} className="usage-row-name text-[13px] font-semibold text-ink-bright">
                    {project.name}
                  </Link>
                  <div className="usage-project-metric min-w-0 [&>span]:block [&>span]:mb-[5px] [&>span]:text-[11px] [&>span]:text-[var(--color-ink-muted)] [&>span]:[font-family:var(--font-console-mono)] [&>span]:tabular-nums">
                    <span>
                      Services {project.serviceCount}/{project.serviceLimit}
                    </span>
                    <div className="usage-mini-track bg-[#23212b] h-[4px] rounded-[9999px] overflow-hidden [&>div]:h-full [&>div]:rounded-[9999px] [&>div]:bg-[var(--color-accent)]" aria-hidden="true">
                      <div
                        style={{
                          width: `${calculatePercent(project.serviceCount, project.serviceLimit)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="usage-project-metric min-w-0 [&>span]:block [&>span]:mb-[5px] [&>span]:text-[11px] [&>span]:text-[var(--color-ink-muted)] [&>span]:[font-family:var(--font-console-mono)] [&>span]:tabular-nums">
                    <span>
                      Databases {project.databaseCount}/{project.databaseLimit}
                    </span>
                    <div className="usage-mini-track bg-[#23212b] h-[4px] rounded-[9999px] overflow-hidden [&>div]:h-full [&>div]:rounded-[9999px] [&>div]:bg-[var(--color-accent)]" aria-hidden="true">
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

          <section className="mb-[26px]" aria-labelledby="services-usage-heading">
            <div className="usage-section-head flex items-baseline justify-between gap-[12px] mb-[10px] [&_h2]:m-0 [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:text-[var(--color-ink-console)] [&_span]:text-[11px] [&_span]:text-[var(--color-ink-muted)] [&_span]:whitespace-nowrap">
              <h2 id="services-usage-heading">Service resource breakdown</h2>
              <span>{usageData.services.length} services</span>
            </div>
            <p className="mt-[-4px] mb-[10px] mx-0 text-[12px] leading-[1.5] text-ink-muted">
              Measured CPU, memory and disk for each deployed container, grouped by project.
            </p>
            <div className="bg-surface border border-surface-raised rounded-card overflow-x-auto">
              {usageData.services.length === 0 ? (
                <div className="py-[40px] px-[20px] text-center">
                  <p className="text-[14px] font-semibold text-ink-bright mt-0 mb-[6px] mx-0">No deployed services</p>
                  <p className="max-w-[460px] my-0 mx-auto text-[12px] leading-[1.5] text-ink-muted">
                    Deploy a service from a project to start measuring container compute and memory.
                  </p>
                </div>
              ) : (
                <table className="usage-table w-full min-w-[640px] text-left [&_thead_th]:text-[11px] [&_thead_th]:font-medium [&_thead_th]:uppercase [&_thead_th]:tracking-[0.05em] [&_thead_th]:text-[var(--color-ink-muted)] [&_thead_th]:px-[14px] [&_thead_th]:py-[10px] [&_thead_th]:border-b [&_thead_th]:border-[var(--color-surface-raised)] [&_thead_th]:bg-[#131217] [&_tbody_td]:px-[14px] [&_tbody_td]:py-[11px] [&_tbody_td]:border-b [&_tbody_td]:border-[#1f1d25] [&_tbody_td]:text-[13px] [&_tbody_td]:align-middle [&_tbody_tr:hover>td]:bg-[rgba(255,255,255,0.015)]">
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
                        <th colSpan={5} scope="rowgroup" className="px-[14px] py-[9px] bg-[#131217] border-b border-[var(--color-surface-raised)] font-normal text-left">
                          <span className="text-[12px] font-semibold text-ink-console">{group.name}</span>
                          <span className="ml-[8px] text-[11px] [font-family:var(--font-console-mono)] text-ink-muted">{group.items.length}</span>
                          <Link
                            href={`/dashboard/projects/${group.id}`}
                            className="text-accent hover:text-[#6ee7b7] ml-[12px] text-[11px]"
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
                              className="usage-row-name text-[13px] font-semibold text-ink-bright"
                            >
                              {service.name}
                            </Link>
                          </td>
                          <td className="usage-number text-[12px] [font-family:var(--font-console-mono)] tabular-nums text-ink-bright [&_span]:text-[var(--color-ink-muted)]">
                            {service.cpuUsage.toFixed(2)}
                            {canSeeLimitDetail ? (
                              <span> / {service.cpuLimit} vCPU</span>
                            ) : (
                              <span> vCPU</span>
                            )}
                          </td>
                          <td className="usage-number text-[12px] [font-family:var(--font-console-mono)] tabular-nums text-ink-bright [&_span]:text-[var(--color-ink-muted)]">
                            {formatMb(service.memoryUsageMb)}
                            {canSeeLimitDetail ? (
                              <span> / {formatMb(service.memoryLimitMb)}</span>
                            ) : null}
                          </td>
                          <td className="usage-number text-[12px] [font-family:var(--font-console-mono)] tabular-nums text-ink-bright [&_span]:text-[var(--color-ink-muted)]">
                            {formatMb(service.volumeUsageMb)}
                            {canSeeLimitDetail ? (
                              <span> / {formatMb(service.volumeLimitMb)}</span>
                            ) : null}
                          </td>
                          <td>
                            <span
                              className={`usage-status-pill inline-flex items-center gap-[6px] h-[22px] py-0 px-[8px] rounded-[9999px] text-[11px] font-medium ${
                                service.status === "running"
                                  ? "bg-[#0f2e21] border border-[#1d4a36] text-[var(--color-accent)]"
                                  : service.status === "failed"
                                    ? "bg-[#2d1419] border border-[#4d222a] text-[#fda4af]"
                                    : "bg-[#2a2012] border border-[#48381c] text-[var(--color-warning)]"
                              }`}
                            >
                              <span className="project-status-dot bg-current w-[6px] h-[6px] rounded-[50%]" aria-hidden="true" />
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
            <section className="mb-[26px]" aria-labelledby="databases-usage-heading">
              <div className="usage-section-head flex items-baseline justify-between gap-[12px] mb-[10px] [&_h2]:m-0 [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:text-[var(--color-ink-console)] [&_span]:text-[11px] [&_span]:text-[var(--color-ink-muted)] [&_span]:whitespace-nowrap">
                <h2 id="databases-usage-heading">Database storage</h2>
                <span>{usageData.databases.length} databases</span>
              </div>
              <p className="mt-[-4px] mb-[10px] mx-0 text-[12px] leading-[1.5] text-ink-muted">
                Measured storage used by each database in this organization.
              </p>
              <div className="bg-surface border border-surface-raised rounded-card overflow-x-auto">
                <table className="usage-table w-full min-w-[640px] text-left [&_thead_th]:text-[11px] [&_thead_th]:font-medium [&_thead_th]:uppercase [&_thead_th]:tracking-[0.05em] [&_thead_th]:text-[var(--color-ink-muted)] [&_thead_th]:px-[14px] [&_thead_th]:py-[10px] [&_thead_th]:border-b [&_thead_th]:border-[var(--color-surface-raised)] [&_thead_th]:bg-[#131217] [&_tbody_td]:px-[14px] [&_tbody_td]:py-[11px] [&_tbody_td]:border-b [&_tbody_td]:border-[#1f1d25] [&_tbody_td]:text-[13px] [&_tbody_td]:align-middle [&_tbody_tr:hover>td]:bg-[rgba(255,255,255,0.015)]">
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
                        <td className="usage-row-name text-[13px] font-semibold text-ink-bright">
                          {database.engine === "mysql" ? "MySQL" : "PostgreSQL"} {database.version}
                        </td>
                        <td>
                          <Link
                            href={`/dashboard/projects/${database.projectId}`}
                            className="text-ink-muted hover:text-ink-console text-[12px]"
                          >
                            {database.projectName}
                          </Link>
                        </td>
                        <td className="usage-number text-[12px] [font-family:var(--font-console-mono)] tabular-nums text-ink-bright [&_span]:text-[var(--color-ink-muted)]">
                          {formatMb(database.usageMb)}
                          {canSeeLimitDetail ? (
                            <span> / {formatMb(database.storageLimitMb)}</span>
                          ) : null}
                        </td>
                        <td>
                          <span
                            className={`usage-status-pill inline-flex items-center gap-[6px] h-[22px] py-0 px-[8px] rounded-[9999px] text-[11px] font-medium ${
                              database.overQuota
                                ? "bg-[#2d1419] border border-[#4d222a] text-[#fda4af]"
                                : "bg-[#0f2e21] border border-[#1d4a36] text-[var(--color-accent)]"
                            }`}
                          >
                            <span className="project-status-dot bg-current w-[6px] h-[6px] rounded-[50%]" aria-hidden="true" />
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
            <section className="mb-[26px]" aria-labelledby="limit-detail-heading">
              <div className="usage-section-head flex items-baseline justify-between gap-[12px] mb-[10px] [&_h2]:m-0 [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:text-[var(--color-ink-console)] [&_span]:text-[11px] [&_span]:text-[var(--color-ink-muted)] [&_span]:whitespace-nowrap">
                <h2 id="limit-detail-heading">Platform allocation policy</h2>
              </div>
              <div className="bg-surface border border-surface-raised rounded-card overflow-hidden">
                <div className="usage-policy-grid grid gap-[16px_24px] p-[18px] grid-cols-[repeat(3,minmax(0,1fr))] [@media(max-width:860px)]:grid-cols-[repeat(2,minmax(0,1fr))] [@media(max-width:720px)]:grid-cols-1 [&>div]:flex [&>div]:flex-col [&>div]:gap-[4px] [&>div]:min-w-0 [&_span]:text-[12px] [&_span]:text-[var(--color-ink-muted)] [&_strong]:text-[13px] [&_strong]:[font-family:var(--font-console-mono)] [&_strong]:font-medium [&_strong]:text-[var(--color-ink-bright)]">
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
                <div className="bg-[#131217] py-[12px] px-[18px] border-t border-t-surface-raised text-[12px] text-ink-muted">
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
