"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Layers,
  Server,
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
  Cpu,
  Activity,
  ArrowUpRight,
  ShieldAlert,
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

export default function ServicesPage() {
  const { toast } = useToast();
  const { data: organization } = useActiveOrganization();
  const { data: activeMember } = useActiveMember();
  const organizationId = organization?.id;
  const canManage = activeMember?.role === "owner" || activeMember?.role === "admin";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Resource queries
  const servicesResource = useResource(
    () => listOrganizationServices(),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );
  const serviceList: OrganizationService[] = useMemo(
    () => servicesResource.data ?? [],
    [servicesResource.data],
  );

  const projectsResource = useResource(
    () => listProjects(),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );
  const projectList: ProjectSummary[] = useMemo(
    () => projectsResource.data ?? [],
    [projectsResource.data],
  );

  const loading = servicesResource.loading;

  // Filtered services
  const filteredServices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return serviceList.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (projectFilter !== "all" && s.projectId !== projectFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.projectName.toLowerCase().includes(q) ||
        s.repoUrl.toLowerCase().includes(q) ||
        s.platformHostname.toLowerCase().includes(q)
      );
    });
  }, [serviceList, search, statusFilter, projectFilter]);

  // Status counters
  const runningCount = useMemo(
    () => serviceList.filter((s) => s.status === "running").length,
    [serviceList],
  );
  const deployingCount = useMemo(
    () => serviceList.filter((s) => s.status === "deploying").length,
    [serviceList],
  );
  const stoppedCount = useMemo(
    () => serviceList.filter((s) => s.status === "stopped" || s.status === "failed").length,
    [serviceList],
  );

  function copyUrl(url: string, id: string) {
    void navigator.clipboard.writeText(url);
    setCopiedId(id);
    toast.success("Copied to clipboard", url);
    setTimeout(() => {
      setCopiedId((prev) => (prev === id ? null : prev));
    }, 2000);
  }

  function renderStatusPill(status: ServiceStatus) {
    const isRunning = status === "running";
    const isDeploying = status === "deploying";
    const isFailed = status === "failed";

    return (
      <span
        className={`services-status-pill ${
          isRunning
            ? "is-running"
            : isDeploying
            ? "is-deploying"
            : isFailed
            ? "is-failed"
            : "is-stopped"
        }`}
      >
        {isDeploying ? (
          <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
        ) : (
          <span className="project-status-dot" aria-hidden="true" />
        )}
        <span>{serviceStatusLabel(status)}</span>
      </span>
    );
  }

  return (
    <div className="services-page-container">
      {/* Header */}
      <header className="services-page-header">
        <div className="flex items-center gap-3">
          <div className="services-header-icon" aria-hidden="true">
            <Server className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="services-page-title">Services</h1>
              <span className="supabase-plan-badge">DOCKER WORKERS</span>
            </div>
            <p className="services-page-subtitle">
              Containerized web applications running with automated HTTPS routing across {organization?.name ?? "your organization"}.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            className="supabase-btn-secondary"
            onClick={() => void servicesResource.refresh()}
            disabled={loading}
            title="Refresh services"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>

          {canManage && (
            <Link
              href="/dashboard/projects"
              className="supabase-btn-green inline-flex items-center"
              title="Select a project to deploy a new service"
            >
              <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />
              <span>New Service</span>
            </Link>
          )}
        </div>
      </header>

      {/* Global Alerts */}
      {servicesResource.error ? (
        <div className="dashboard-alert is-error my-4" role="alert">
          {servicesResource.error}
        </div>
      ) : null}

      {/* Overview Metric Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" aria-label="Services overview">
        <div className="services-metric-card">
          <div className="flex items-center justify-between">
            <span className="services-metric-label">Total Services</span>
            <Server className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="services-metric-val">{serviceList.length}</span>
            <span className="text-xs text-zinc-500 font-mono">/ {QUOTAS.servicesPerOrganization} limit</span>
          </div>
          <span className="text-[11px] text-zinc-500">Across all projects</span>
        </div>

        <div className="services-metric-card">
          <div className="flex items-center justify-between">
            <span className="services-metric-label">Healthy &amp; Running</span>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(62,207,142,0.6)]" />
          </div>
          <span className="services-metric-val text-emerald-400">{runningCount}</span>
          <span className="text-[11px] text-zinc-500">Handling live traffic</span>
        </div>

        <div className="services-metric-card">
          <div className="flex items-center justify-between">
            <span className="services-metric-label">Deploying</span>
            <Loader2 className={`w-4 h-4 ${deployingCount > 0 ? "text-amber-400 animate-spin" : "text-zinc-500"}`} />
          </div>
          <span className="services-metric-val text-amber-400">{deployingCount}</span>
          <span className="text-[11px] text-zinc-500">Builds in queue or progress</span>
        </div>

        <div className="services-metric-card">
          <div className="flex items-center justify-between">
            <span className="services-metric-label">Stopped / Suspended</span>
            <ShieldAlert className="w-4 h-4 text-zinc-500" />
          </div>
          <span className="services-metric-val">{stoppedCount}</span>
          <span className="text-[11px] text-zinc-500">Idle or failed containers</span>
        </div>
      </section>

      {/* Toolbar */}
      <div className="services-toolbar">
        <div className="services-toolbar-left">
          <div className="services-search-box">
            <Search className="services-search-icon" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search services by name, repo, or project..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="services-search-input"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="services-search-clear"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="supabase-filter-select"
            aria-label="Filter by service status"
          >
            <option value="all">All Statuses</option>
            <option value="running">Running</option>
            <option value="deploying">Deploying</option>
            <option value="stopped">Stopped</option>
            <option value="failed">Failed</option>
            <option value="not_deployed">Not Deployed</option>
          </select>

          {projectList.length > 0 && (
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="supabase-filter-select"
              aria-label="Filter by project"
            >
              <option value="all">All Projects</option>
              {projectList.map((p) => (
                <option key={p.id} value={p.id}>
                  Project: {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="services-toolbar-right">
          <span className="services-count-pill">{filteredServices.length} Services</span>

          <div className="supabase-view-toggle-group">
            <button
              type="button"
              className={`supabase-view-btn ${viewMode === "grid" ? "is-active" : ""}`}
              onClick={() => setViewMode("grid")}
              aria-label="Grid view"
              title="Grid view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              className={`supabase-view-btn ${viewMode === "list" ? "is-active" : ""}`}
              onClick={() => setViewMode("list")}
              aria-label="List view"
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Services List / Grid */}
      {loading && serviceList.length === 0 ? (
        <div className="services-grid" aria-label="Loading services">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="services-skeleton-card" aria-hidden="true">
              <div className="flex items-center gap-3 mb-4">
                <div className="supabase-skeleton-box w-9 h-9 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <div className="supabase-skeleton-box h-4 w-36 rounded" />
                  <div className="supabase-skeleton-box h-3 w-24 rounded" />
                </div>
              </div>
              <div className="supabase-skeleton-box h-4 w-full rounded mb-3" />
              <div className="supabase-skeleton-box h-3 w-2/3 rounded" />
            </div>
          ))}
        </div>
      ) : filteredServices.length === 0 ? (
        <div className="services-empty-box">
          <div className="services-empty-halo" aria-hidden="true">
            <Server className="w-7 h-7 text-emerald-400" />
          </div>
          <h2 className="text-base font-semibold text-white mt-3">
            {search || statusFilter !== "all" || projectFilter !== "all"
              ? "No services match your filters"
              : "No services deployed yet"}
          </h2>
          <p className="text-xs text-zinc-400 max-w-md mt-1 mb-5">
            {search || statusFilter !== "all" || projectFilter !== "all"
              ? "Try resetting your search query or filters to see all services."
              : "Deploy your first web application from a Git repository inside a project with automated Docker builds and zero-downtime HTTPS."}
          </p>

          {search || statusFilter !== "all" || projectFilter !== "all" ? (
            <button
              type="button"
              className="supabase-btn-secondary"
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
                setProjectFilter("all");
              }}
            >
              Reset Filters
            </button>
          ) : (
            <Link href="/dashboard/projects" className="supabase-btn-green inline-flex items-center">
              <Plus className="w-4 h-4 mr-1.5" />
              <span>Go to Projects</span>
            </Link>
          )}
        </div>
      ) : viewMode === "grid" ? (
        /* GRID VIEW */
        <div className="services-grid">
          {filteredServices.map((service) => (
            <div key={service.id} className="services-card">
              {/* Card Top */}
              <div className="services-card-header">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="services-card-icon-box" aria-hidden="true">
                    <Server className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/services/${service.id}`}
                      className="services-card-name hover:text-emerald-400 transition-colors block truncate"
                      title={service.name}
                    >
                      {service.name}
                    </Link>
                    <Link
                      href={`/dashboard/projects/${service.projectId}`}
                      className="services-card-project-link inline-flex items-center gap-1"
                    >
                      <Layers className="w-3 h-3 text-zinc-500" />
                      <span className="truncate">{service.projectName}</span>
                    </Link>
                  </div>
                </div>

                {renderStatusPill(service.status)}
              </div>

              {/* Git Repository Info */}
              <div className="services-card-git-box">
                <div className="flex items-center gap-1.5 text-xs text-zinc-300 min-w-0">
                  <GitBranch className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                  <span className="font-mono text-[11px] text-zinc-400 font-semibold px-1.5 py-0.5 rounded bg-zinc-800">
                    {service.branch}
                  </span>
                  <span className="text-[11px] text-zinc-500 truncate" title={service.repoUrl}>
                    {service.repoUrl.replace(/^https?:\/\//, "")}
                  </span>
                </div>
              </div>

              {/* Platform URL */}
              <div className="services-card-url-box">
                <a
                  href={service.url}
                  target="_blank"
                  rel="noreferrer"
                  className="services-card-url text-xs font-mono text-emerald-400 hover:underline truncate"
                  title="Open live service in new tab"
                >
                  {service.platformHostname}
                </a>
                <button
                  type="button"
                  onClick={() => copyUrl(service.url, service.id)}
                  className="text-zinc-500 hover:text-white transition-colors p-1"
                  title="Copy full HTTPS URL"
                  aria-label={`Copy URL for ${service.name}`}
                >
                  {copiedId === service.id ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              {/* Card Footer */}
              <div className="services-card-footer">
                <div className="flex items-center gap-3 text-xs text-zinc-500 font-mono">
                  <span className="flex items-center gap-1" title="CPU Allocation">
                    <Cpu className="w-3.5 h-3.5" />
                    <span>{service.cpuLimit} vCPU</span>
                  </span>
                  <span className="flex items-center gap-1" title="Memory Limit">
                    <Activity className="w-3.5 h-3.5" />
                    <span>{service.memoryLimitMb} MB</span>
                  </span>
                </div>

                <Link
                  href={`/dashboard/services/${service.id}`}
                  className="services-card-manage-link"
                >
                  <span>Manage</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* LIST VIEW */
        <div className="services-table-card">
          <table className="services-table">
            <thead>
              <tr>
                <th scope="col">Service Name</th>
                <th scope="col">Project</th>
                <th scope="col">Status</th>
                <th scope="col">Platform URL</th>
                <th scope="col">Specs</th>
                <th scope="col">Port</th>
                <th scope="col" className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredServices.map((service) => (
                <tr key={service.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div className="services-row-icon" aria-hidden="true">
                        <Server className="w-3.5 h-3.5 text-emerald-400" />
                      </div>
                      <div>
                        <Link
                          href={`/dashboard/services/${service.id}`}
                          className="font-semibold text-white hover:text-emerald-400 transition-colors text-xs block"
                        >
                          {service.name}
                        </Link>
                        <div className="flex items-center gap-1 text-[11px] text-zinc-500 font-mono mt-0.5">
                          <GitBranch className="w-3 h-3" />
                          <span>{service.branch}</span>
                        </div>
                      </div>
                    </div>
                  </td>

                  <td>
                    <Link
                      href={`/dashboard/projects/${service.projectId}`}
                      className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors inline-flex items-center gap-1"
                    >
                      <Layers className="w-3 h-3 text-zinc-500" />
                      <span>{service.projectName}</span>
                    </Link>
                  </td>

                  <td>{renderStatusPill(service.status)}</td>

                  <td>
                    <div className="flex items-center gap-1.5">
                      <a
                        href={service.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-mono text-emerald-400 hover:underline max-w-[200px] truncate"
                        title={service.url}
                      >
                        {service.platformHostname}
                      </a>
                      <button
                        type="button"
                        onClick={() => copyUrl(service.url, service.id)}
                        className="text-zinc-500 hover:text-white transition-colors"
                        title="Copy full URL"
                      >
                        {copiedId === service.id ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </td>

                  <td className="text-xs font-mono text-zinc-400">
                    {service.cpuLimit} vCPU · {service.memoryLimitMb} MB
                  </td>

                  <td className="text-xs font-mono text-zinc-400">
                    :{service.containerPort}
                  </td>

                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <a
                        href={service.url}
                        target="_blank"
                        rel="noreferrer"
                        className="supabase-btn-secondary text-xs h-7 px-2 inline-flex items-center gap-1"
                        title="Visit live site"
                      >
                        <span>Visit</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>

                      <Link
                        href={`/dashboard/services/${service.id}`}
                        className="supabase-btn-secondary text-xs h-7 px-2.5 inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
                      >
                        <span>Manage</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
