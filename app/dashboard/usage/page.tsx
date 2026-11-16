"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useActiveMember, useActiveOrganization } from "@/lib/auth-client";
import { getOrganizationUsage, type OrganizationUsage } from "@/lib/usage-client";

function getError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function megabytes(value: number): string {
  return `${value} MB`;
}

function QuotaRow({
  label,
  used,
  limit,
  unit = "",
}: {
  label: string;
  used: number;
  limit: number;
  unit?: string;
}) {
  const atLimit = limit > 0 && used >= limit;

  return (
    <tr>
      <td>{label}</td>
      <td>
        {used}
        {unit}
      </td>
      <td>
        {limit}
        {unit}
      </td>
      <td>
        <span className={`role-label is-${atLimit ? "failed" : "running"}`}>
          {atLimit ? "At limit" : "Within Quota"}
        </span>
      </td>
    </tr>
  );
}

/**
 * Organization Quota and measured usage. Every role sees the counts and the
 * latest measurement; owners and admins also get the fixed per-resource limit
 * detail. Opening the page triggers a fresh measurement before the data is
 * rendered, and the worker refreshes it again every five minutes.
 */
export default function UsagePage() {
  const { data: organization } = useActiveOrganization();
  const { data: activeMember } = useActiveMember();
  const [usage, setUsage] = useState<OrganizationUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const organizationId = organization?.id;
  const canSeeLimitDetail = activeMember?.role === "owner" || activeMember?.role === "admin";

  const refresh = useCallback(async () => {
    if (!organizationId) return;
    try {
      setUsage(await getOrganizationUsage());
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

  if (loading) {
    return (
      <div className="dashboard-content">
        <p className="dashboard-table-empty" role="status">
          Loading Quota...
        </p>
      </div>
    );
  }

  const maxServicesPerProject =
    usage?.projects.reduce((max, project) => Math.max(max, project.serviceCount), 0) ?? 0;
  const maxDatabasesPerProject =
    usage?.projects.reduce((max, project) => Math.max(max, project.databaseCount), 0) ?? 0;

  return (
    <div className="dashboard-content">
      <div className="dashboard-page-heading">
        <div>
          <h1>Usage &amp; Quota</h1>
          <p>
            Limits and measured usage for {organization?.name ?? "your Organization"}. CPU, memory,
            Volume, and Database storage are refreshed every five minutes and when this page opens.
          </p>
        </div>
        {usage?.capturedAt ? (
          <span className="project-quota">Measured {formatTime(usage.capturedAt)}</span>
        ) : null}
      </div>

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
        </p>
      ) : null}

      {!usage ? (
        <div className="dashboard-empty-state">
          <h3>Quota unavailable</h3>
          <p>The Organization Quota could not be loaded. Try again in a moment.</p>
        </div>
      ) : (
        <>
          <section className="dashboard-section" aria-labelledby="quota-heading">
            <div className="dashboard-section-heading">
              <h2 id="quota-heading">Quota</h2>
              <button className="dashboard-link-button" type="button" onClick={() => void refresh()}>
                Refresh
              </button>
            </div>

            <div className="organization-table-wrap">
              <table className="organization-table">
                <thead>
                  <tr>
                    <th>Resource</th>
                    <th>Usage</th>
                    <th>Limit</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <QuotaRow
                    label="Projects"
                    used={usage.counts.projects.used}
                    limit={usage.counts.projects.limit}
                  />
                  <QuotaRow
                    label="Services in this Organization"
                    used={usage.counts.services.used}
                    limit={usage.counts.services.limit}
                  />
                  <QuotaRow
                    label="Services in the busiest Project"
                    used={maxServicesPerProject}
                    limit={usage.limits.servicesPerProject}
                  />
                  <QuotaRow
                    label="Databases in the busiest Project"
                    used={maxDatabasesPerProject}
                    limit={usage.limits.databasesPerProject}
                  />
                </tbody>
              </table>
            </div>
          </section>

          <section className="dashboard-section" aria-labelledby="usage-heading">
            <div className="dashboard-section-heading">
              <h2 id="usage-heading">Measured usage</h2>
            </div>

            <dl className="service-meta">
              <div>
                <dt>CPU</dt>
                <dd>{usage.totals.cpu.toFixed(2)} vCPU</dd>
              </div>
              <div>
                <dt>Memory</dt>
                <dd>{megabytes(usage.totals.memoryMb)}</dd>
              </div>
              <div>
                <dt>Volume</dt>
                <dd>{megabytes(usage.totals.volumeMb)}</dd>
              </div>
              <div>
                <dt>Database storage</dt>
                <dd>{megabytes(usage.totals.databaseMb)}</dd>
              </div>
            </dl>

            {usage.services.length === 0 ? (
              <p className="dashboard-table-empty">No Services yet.</p>
            ) : (
              <div className="organization-table-wrap">
                <table className="organization-table">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Project</th>
                      <th>CPU</th>
                      <th>Memory</th>
                      <th>Volume</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.services.map((service) => (
                      <tr key={service.id}>
                        <td>
                          <Link href={`/dashboard/services/${service.id}`}>{service.name}</Link>
                        </td>
                        <td>
                          <Link href={`/dashboard/projects/${service.projectId}`}>
                            {service.projectName}
                          </Link>
                        </td>
                        <td>
                          {service.cpuUsage.toFixed(2)}
                          {canSeeLimitDetail ? ` of ${service.cpuLimit} vCPU` : " vCPU"}
                        </td>
                        <td>
                          {canSeeLimitDetail
                            ? `${megabytes(service.memoryUsageMb)} of ${megabytes(service.memoryLimitMb)}`
                            : megabytes(service.memoryUsageMb)}
                        </td>
                        <td>
                          {canSeeLimitDetail
                            ? `${megabytes(service.volumeUsageMb)} of ${megabytes(service.volumeLimitMb)}`
                            : megabytes(service.volumeUsageMb)}
                        </td>
                        <td>
                          <span className="role-label">{service.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {usage.databases.length > 0 ? (
              <div className="organization-table-wrap">
                <table className="organization-table">
                  <thead>
                    <tr>
                      <th>Database</th>
                      <th>Project</th>
                      <th>Storage</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.databases.map((database) => (
                      <tr key={database.id}>
                        <td>PostgreSQL</td>
                        <td>
                          <Link href={`/dashboard/projects/${database.projectId}`}>
                            {database.projectName}
                          </Link>
                        </td>
                        <td>
                          {canSeeLimitDetail
                            ? `${megabytes(database.usageMb)} of ${megabytes(database.storageLimitMb)}`
                            : megabytes(database.usageMb)}
                        </td>
                        <td>
                          <span className={`role-label is-${database.overQuota ? "failed" : "running"}`}>
                            {database.overQuota ? "Over Quota" : database.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          {canSeeLimitDetail ? (
            <section className="dashboard-section" aria-labelledby="limit-detail-heading">
              <div className="dashboard-section-heading">
                <h2 id="limit-detail-heading">Limit detail</h2>
              </div>

              <div className="organization-table-wrap">
                <table className="organization-table">
                  <thead>
                    <tr>
                      <th>Resource</th>
                      <th>Limit</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>CPU per Service</td>
                      <td>{usage.limits.cpuPerService} vCPU</td>
                    </tr>
                    <tr>
                      <td>RAM per Service</td>
                      <td>{megabytes(usage.limits.memoryMbPerService)}</td>
                    </tr>
                    <tr>
                      <td>Volume per Service</td>
                      <td>{megabytes(usage.limits.volumeMbPerService)}</td>
                    </tr>
                    <tr>
                      <td>Storage per Database</td>
                      <td>{megabytes(usage.limits.databaseStorageMb)}</td>
                    </tr>
                    <tr>
                      <td>Build concurrency per node</td>
                      <td>{usage.limits.buildConcurrencyPerNode}</td>
                    </tr>
                    <tr>
                      <td>Log retention</td>
                      <td>{usage.limits.logRetentionDays} days</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="project-quota-note">
                Lowering a Quota never deletes an existing resource. Resources keep running until an
                owner or admin deletes them.
              </p>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
