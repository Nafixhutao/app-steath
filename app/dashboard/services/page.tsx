"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useActiveOrganization } from "@/lib/auth-client";
import { QUOTAS } from "@/lib/platform/quota-limits";
import {
  listOrganizationServices,
  serviceStatusLabel,
  type OrganizationService,
} from "@/lib/services-client";

function getError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

export default function ServicesPage() {
  const { data: organization } = useActiveOrganization();
  const [services, setServices] = useState<OrganizationService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const organizationId = organization?.id;

  const refresh = useCallback(async () => {
    if (!organizationId) return;
    try {
      setServices(await listOrganizationServices());
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
          <h1>Services</h1>
          <p>Deploy web Services from public Git repositories.</p>
        </div>
        <span className="project-quota">
          {services.length} of {QUOTAS.servicesPerOrganization} Services
        </span>
      </div>

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="dashboard-section" aria-labelledby="services-list-heading">
        <div className="dashboard-section-heading">
          <h2 id="services-list-heading">
            Services <span className="dashboard-count">{services.length}</span>
          </h2>
          <Link href="/dashboard/projects">View Projects</Link>
        </div>

        {loading ? (
          <p className="dashboard-table-empty" role="status">
            Loading Services...
          </p>
        ) : services.length === 0 ? (
          <div className="dashboard-empty-state">
            <h3>No Services yet</h3>
            <p>Open a Project and create a Service from a public repository.</p>
          </div>
        ) : (
          <div className="organization-table-wrap">
            <table className="organization-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Platform Subdomain</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr key={service.id}>
                    <td>
                      <strong>
                        <Link href={`/dashboard/services/${service.id}`}>{service.name}</Link>
                      </strong>
                      <small>
                        {service.repoUrl} @ {service.branch}
                      </small>
                    </td>
                    <td>
                      <Link href={`/dashboard/projects/${service.projectId}`}>
                        {service.projectName}
                      </Link>
                    </td>
                    <td>
                      <span className="role-label">{serviceStatusLabel(service.status)}</span>
                    </td>
                    <td>
                      <a
                        className="service-url"
                        href={service.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {service.platformHostname}
                      </a>
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
