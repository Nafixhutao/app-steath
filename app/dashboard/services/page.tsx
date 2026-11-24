"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  X,
  ExternalLink,
  Plus,
  RefreshCw,
  LayoutGrid,
  List,
  GitBranch,
  Copy,
  Check,
  ArrowUpRight,
  Loader2,
} from "lucide-react";
import { useActiveMember, useActiveOrganization } from "@/lib/auth-client";
import { QUOTAS } from "@/lib/platform/quota-limits";
import { useResource } from "@/lib/resource";
import {
  listOrganizationServices,
  serviceStatusLabel,
  type OrganizationService,
  type ServiceStatus,
} from "@/lib/services-client";
import { listProjects, type ProjectSummary } from "@/lib/projects-client";
import { useToast } from "@/components/toast-context";
import { copyToClipboard } from "@/lib/clipboard";

export default function ServicesPage() {
  const { toast } = useToast();
  const { data: organization } = useActiveOrganization();
  const { data: activeMember } = useActiveMember();
  const organizationId = organization?.id;
  // Better Auth stores multiple roles as a comma-separated string, so check the
  // parsed set rather than the raw value.
  const canManage =
    activeMember?.role
      .split(",")
      .some((role) => role.trim() === "owner" || role.trim() === "admin") ?? false;

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const servicesResource = useResource(() => listOrganizationServices(), [organizationId], {
    enabled: Boolean(organizationId),
  });
  const serviceList: OrganizationService[] = useMemo(
    () => servicesResource.data ?? [],
    [servicesResource.data],
  );

  const projectsResource = useResource(() => listProjects(), [organizationId], {
    enabled: Boolean(organizationId),
  });
  const projectList: ProjectSummary[] = useMemo(
    () => projectsResource.data ?? [],
    [projectsResource.data],
  );

  const loading = servicesResource.loading;
  const hasFilters = Boolean(search) || statusFilter !== "all" || projectFilter !== "all";

  const filteredServices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return serviceList.filter((service) => {
      if (statusFilter !== "all" && service.status !== statusFilter) return false;
      if (projectFilter !== "all" && service.projectId !== projectFilter) return false;
      if (!q) return true;
      return (
        service.name.toLowerCase().includes(q) ||
        service.projectName.toLowerCase().includes(q) ||
        service.repoUrl.toLowerCase().includes(q) ||
        service.platformHostname.toLowerCase().includes(q)
      );
    });
  }, [serviceList, search, statusFilter, projectFilter]);

  // Grouping is the page's hierarchy: a service is always read inside its
  // project, so the project name becomes a label instead of a repeated column.
  const groups = useMemo(() => {
    const byProject = new Map<string, { name: string; items: OrganizationService[] }>();
    for (const service of filteredServices) {
      const group = byProject.get(service.projectId) ?? { name: service.projectName, items: [] };
      group.items.push(service);
      byProject.set(service.projectId, group);
    }
    return Array.from(byProject, ([id, value]) => ({ id, ...value }));
  }, [filteredServices]);

  const runningCount = serviceList.filter((service) => service.status === "running").length;
  const deployingCount = serviceList.filter((service) => service.status === "deploying").length;
  const attentionCount = serviceList.filter(
    (service) => service.status === "failed" || service.status === "stopped",
  ).length;

  async function copyUrl(url: string, id: string) {
    if (!(await copyToClipboard(url))) {
      toast.error("Copy failed", "Clipboard access is unavailable.");
      return;
    }
    setCopiedId(id);
    toast.success("Copied to clipboard", url);
    setTimeout(() => {
      setCopiedId((prev) => (prev === id ? null : prev));
    }, 2000);
  }

  function renderStatusPill(status: ServiceStatus) {
    const variant =
      status === "running"
        ? "is-running"
        : status === "deploying"
          ? "is-deploying"
          : status === "failed"
            ? "is-failed"
            : status === "suspended"
              ? "is-suspended"
              : status === "not_deployed"
                ? "is-not-deployed"
                : "is-stopped";

    return (
      <span className={`services-status-pill ${variant}`}>
        {status === "deploying" ? (
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
        ) : (
          <span className="project-status-dot" aria-hidden="true" />
        )}
        <span>{serviceStatusLabel(status)}</span>
      </span>
    );
  }

  function renderCopyButton(service: OrganizationService) {
    return (
      <button
        type="button"
        onClick={() => copyUrl(service.url, service.id)}
        className="services-copy-btn"
        title="Copy full HTTPS URL"
        aria-label={`Copy URL for ${service.name}`}
      >
        {copiedId === service.id ? (
          <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
        ) : (
          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
        )}
      </button>
    );
  }

  return (
    <div className="services-page-container">
      <header className="services-page-header">
        <div className="min-w-0">
          <h1 className="services-page-title">Services</h1>
          <p className="services-page-subtitle">
            Containers, builds and public routing for {organization?.name ?? "your organization"}.
          </p>
        </div>

        <div className="services-header-actions">
          <button
            type="button"
            className="supabase-btn-secondary"
            onClick={() => void servicesResource.refresh()}
            disabled={loading}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            <span>Refresh</span>
          </button>
          {canManage ? (
            <Link
              href="/dashboard/projects"
              className="supabase-btn-green inline-flex items-center"
              title="Select a project to deploy a new service"
            >
              <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />
              <span>New Service</span>
            </Link>
          ) : null}
        </div>
      </header>

      {servicesResource.error ? (
        <div className="dashboard-alert is-error services-alert" role="alert">
          {servicesResource.error}
        </div>
      ) : null}

      <div className="services-summary" aria-label="Services summary">
        <div className="services-summary-total">
          <strong>{serviceList.length}</strong>
          <span>services across {projectList.length} projects</span>
        </div>
        <div className="services-summary-states">
          <span className="services-summary-state is-running">
            <span className="project-status-dot" aria-hidden="true" />
            {runningCount} running
          </span>
          <span className="services-summary-state is-deploying">{deployingCount} deploying</span>
          <span className="services-summary-state is-attention">
            {attentionCount} need attention
          </span>
        </div>
        <span className="services-summary-quota">
          {serviceList.length} / {QUOTAS.servicesPerOrganization} used
        </span>
      </div>

      <div className="services-toolbar">
        <div className="services-toolbar-left">
          <div className="services-search-box">
            <Search className="services-search-icon" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search name, repo or hostname..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="services-search-input"
              aria-label="Search services"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="services-search-clear"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="supabase-filter-select"
            aria-label="Filter by service status"
          >
            <option value="all">All statuses</option>
            <option value="running">Running</option>
            <option value="deploying">Deploying</option>
            <option value="stopped">Stopped</option>
            <option value="failed">Failed</option>
            <option value="suspended">Suspended</option>
            <option value="not_deployed">Not deployed</option>
          </select>

          {projectList.length > 0 ? (
            <select
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
              className="supabase-filter-select"
              aria-label="Filter by project"
            >
              <option value="all">All projects</option>
              {projectList.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="services-toolbar-right">
          <span className="services-count">{filteredServices.length} shown</span>
          <div className="supabase-view-toggle-group" role="group" aria-label="View mode">
            <button
              type="button"
              className={`supabase-view-btn ${viewMode === "grid" ? "is-active" : ""}`}
              onClick={() => setViewMode("grid")}
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
              title="Grid view"
            >
              <LayoutGrid className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`supabase-view-btn ${viewMode === "list" ? "is-active" : ""}`}
              onClick={() => setViewMode("list")}
              aria-label="List view"
              aria-pressed={viewMode === "list"}
              title="List view"
            >
              <List className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {loading && serviceList.length === 0 ? (
        <div className="services-grid" role="status" aria-label="Loading services">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="services-skeleton-card" aria-hidden="true">
              <div className="supabase-skeleton-box h-4 w-36 rounded mb-3" />
              <div className="supabase-skeleton-box h-3 w-24 rounded mb-4" />
              <div className="supabase-skeleton-box h-3 w-2/3 rounded" />
            </div>
          ))}
        </div>
      ) : filteredServices.length === 0 ? (
        <div className="services-empty-box">
          <h2 className="services-empty-title">
            {hasFilters ? "No services match these filters" : "No services yet"}
          </h2>
          <p className="services-empty-copy">
            {hasFilters
              ? "Clear the search or filters to see the rest of the fleet."
              : "Create a project, then deploy a service from a Git repository. HTTPS routing is set up for you."}
          </p>
          {hasFilters ? (
            <button
              type="button"
              className="supabase-btn-secondary"
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
                setProjectFilter("all");
              }}
            >
              Reset filters
            </button>
          ) : (
            <Link
              href="/dashboard/projects"
              className="supabase-btn-green inline-flex items-center"
            >
              <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />
              <span>Go to Projects</span>
            </Link>
          )}
        </div>
      ) : viewMode === "grid" ? (
        <div className="services-view">
          {groups.map((group) => (
            <section key={group.id} className="services-group" aria-label={`Project ${group.name}`}>
              <div className="services-group-head">
                <h2 className="services-group-name">{group.name}</h2>
                <span className="services-group-count">{group.items.length}</span>
                <Link href={`/dashboard/projects/${group.id}`} className="services-group-link">
                  Open project
                  <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                </Link>
              </div>
              <div className="services-grid">
                {group.items.map((service) => (
                  <article key={service.id} className="services-card">
                    <div className="services-card-header">
                      <div className="min-w-0">
                        <Link
                          href={`/dashboard/services/${service.id}`}
                          className="services-card-name"
                          title={service.name}
                        >
                          {service.name}
                        </Link>
                        <div className="services-card-meta">
                          <GitBranch className="w-3 h-3" aria-hidden="true" />
                          <span className="services-mono">{service.branch}</span>
                          <span aria-hidden="true">·</span>
                          <span title={service.repoUrl}>
                            {service.repoUrl.replace(/^https?:\/\//, "").split("/")[0]}
                          </span>
                        </div>
                      </div>
                      {renderStatusPill(service.status)}
                    </div>

                    <div className="services-card-url-row">
                      <a
                        href={service.url}
                        target="_blank"
                        rel="noreferrer"
                        className="services-card-url"
                        title="Open live service in a new tab"
                      >
                        {service.platformHostname}
                      </a>
                      {renderCopyButton(service)}
                    </div>

                    <div className="services-card-footer">
                      <span className="services-specs">
                        {service.cpuLimit} vCPU · {service.memoryLimitMb} MB · :
                        {service.containerPort}
                      </span>
                      <Link
                        href={`/dashboard/services/${service.id}`}
                        className="services-card-manage-link"
                      >
                        Manage
                        <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="services-table-card">
          <table className="services-table">
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Status</th>
                <th scope="col">Platform URL</th>
                <th scope="col">Specs</th>
                <th scope="col">Port</th>
                <th scope="col" className="text-right">
                  Action
                </th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.id}>
                <tr className="services-group-row">
                  <th colSpan={6} scope="rowgroup">
                    <span className="services-group-name">{group.name}</span>
                    <span className="services-group-count">{group.items.length}</span>
                    <Link href={`/dashboard/projects/${group.id}`} className="services-group-link">
                      Open project
                      <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                    </Link>
                  </th>
                </tr>
                {group.items.map((service) => (
                  <tr key={service.id}>
                    <td>
                      <Link
                        href={`/dashboard/services/${service.id}`}
                        className="services-row-name"
                      >
                        {service.name}
                      </Link>
                      <div className="services-card-meta">
                        <GitBranch className="w-3 h-3" aria-hidden="true" />
                        <span className="services-mono">{service.branch}</span>
                        <span aria-hidden="true">·</span>
                        <span title={service.repoUrl}>
                          {service.repoUrl.replace(/^https?:\/\//, "").split("/")[0]}
                        </span>
                      </div>
                    </td>
                    <td>{renderStatusPill(service.status)}</td>
                    <td>
                      <div className="services-url-cell">
                        <a
                          href={service.url}
                          target="_blank"
                          rel="noreferrer"
                          className="services-card-url"
                          title={service.url}
                        >
                          {service.platformHostname}
                        </a>
                        {renderCopyButton(service)}
                      </div>
                    </td>
                    <td className="services-specs">
                      {service.cpuLimit} vCPU · {service.memoryLimitMb} MB
                    </td>
                    <td className="services-mono">:{service.containerPort}</td>
                    <td>
                      <div className="services-row-actions">
                        <a
                          href={service.url}
                          target="_blank"
                          rel="noreferrer"
                          className="supabase-btn-secondary services-row-btn"
                          title="Visit live site"
                        >
                          <span>Visit</span>
                          <ExternalLink className="w-3 h-3" aria-hidden="true" />
                        </a>
                        <Link
                          href={`/dashboard/services/${service.id}`}
                          className="supabase-btn-secondary services-row-btn services-row-btn-accent"
                        >
                          <span>Manage</span>
                          <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}
