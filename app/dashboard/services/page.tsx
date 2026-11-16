"use client";

import Link from "next/link";
import { useActiveOrganization } from "@/lib/auth-client";
import { QUOTAS } from "@/lib/platform/quota-limits";
import { useResource } from "@/lib/resource";
import {
  listOrganizationServices,
  serviceStatusLabel,
  type OrganizationService,
} from "@/lib/services-client";

export default function ServicesPage() {
  const { data: organization } = useActiveOrganization();
  const organizationId = organization?.id;

  const services = useResource(() => listOrganizationServices(), [organizationId], {
    enabled: Boolean(organizationId),
  });
  const serviceList: OrganizationService[] = services.data ?? [];

  return (
    <div className="dashboard-content">
      <div className="dashboard-page-heading">
        <div>
          <h1>Services</h1>
          <p>Deploy web Services from public Git repositories.</p>
        </div>
        <span className="project-quota">
          {serviceList.length} of {QUOTAS.servicesPerOrganization} Services
        </span>
      </div>

      {services.error ? (
        <p className="dashboard-alert is-error" role="alert">
          {services.error}
        </p>
      ) : null}

      <section className="dashboard-section" aria-labelledby="services-list-heading">
        <div className="dashboard-section-heading">
          <h2 id="services-list-heading">
            Services <span className="dashboard-count">{serviceList.length}</span>
          </h2>
          <Link href="/dashboard/projects">View Projects</Link>
        </div>

        {services.loading ? (
          <p className="dashboard-table-empty" role="status">
            Loading Services...
          </p>
        ) : serviceList.length === 0 ? (
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
                {serviceList.map((service) => (
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
