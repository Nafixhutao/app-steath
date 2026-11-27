"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Boxes,
  Plus,
  Search,
  LayoutGrid,
  List,
  ChevronDown,
  X,
  Database,
  Layers,
  ArrowUpRight,
  Circle,
} from "lucide-react";
import { useActiveMember, useActiveOrganization } from "@/lib/auth-client";
import { createProject, listProjects, type ProjectSummary } from "@/lib/projects-client";
import { QUOTAS } from "@/lib/platform/quota-limits";
import { getError, useResource } from "@/lib/resource";
import { MAX_SLUG_LENGTH, slugify } from "@/lib/slug";
import { useToast } from "@/components/toast-context";
import { ModalDialog } from "@/components/supabase-modal";

export default function ProjectsPage() {
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
  const limit = QUOTAS.projectsPerOrganization;

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "empty">("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Create Project Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const projects = useResource(() => listProjects(), [organizationId], {
    enabled: Boolean(organizationId),
  });
  const projectList: ProjectSummary[] = useMemo(() => projects.data ?? [], [projects.data]);
  const atLimit = projectList.length >= limit;

  // Total DBs and services in organization
  const totalDatabases = useMemo(
    () => projectList.reduce((acc, p) => acc + (p.databaseCount || 0), 0),
    [projectList],
  );

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projectList.filter((p) => {
      if (statusFilter === "active" && p.status !== "active") return false;
      if (statusFilter === "empty" && p.status !== "empty") return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q);
    });
  }, [projectList, search, statusFilter]);

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const createdName = name.trim();
      await createProject({ name: createdName, slug: slug.trim() || undefined });
      setName("");
      setSlug("");
      setSlugEdited(false);
      setModalOpen(false);
      toast.success("Project created", `"${createdName}" is ready.`);
      await projects.refresh();
    } catch (cause) {
      setFormError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-[28px] pb-[60px] px-[36px] max-w-[1400px] mx-auto w-full">
      <div className="mb-[20px]">
        <h1 className="text-[26px]! font-semibold! tracking-[-0.02em]! text-ink m-0">Projects</h1>
      </div>

      {projects.error ? (
        <div className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error mb-4" role="alert">
          {projects.error}
        </div>
      ) : null}

      {/* Toolbar matching Image 2 */}
      <div className="flex items-center justify-between flex-wrap gap-[12px] mb-[24px]">
        <div className="flex items-center gap-[10px] flex-wrap">
          <div className="supabase-project-search relative flex items-center w-[240px]">
            <Search className="w-4 h-4 text-zinc-500" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search for a project"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="supabase-project-search-input bg-surface w-full h-[34px] py-0 pr-[28px] pl-[32px] rounded-control border border-[#282631] text-ink-console text-[13px]! outline-none [transition:border-color_150ms]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-[8px] bg-transparent border-0 text-[#716f7c] cursor-pointer p-[2px] flex"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="relative flex items-center">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "empty")}
              className="supabase-filter-select bg-surface h-[34px] py-0 pr-[28px] pl-[10px] rounded-control border border-[#282631] text-[#c9c7d2] text-[13px] cursor-pointer outline-none"
              aria-label="Filter by project status"
            >
              <option value="all">Status: All</option>
              <option value="active">Status: Active</option>
              <option value="empty">Status: Empty</option>
            </select>
            <ChevronDown className="absolute right-[8px] w-[14px] h-[14px] text-[#716f7c] pointer-events-none" aria-hidden="true" />
          </div>

          <div className="relative flex items-center">
            <span className="inline-flex items-center h-[34px] py-0 px-[12px] rounded-control border border-[#282631] bg-surface text-[#8e8c99] text-[13px] select-none">Sorted by name</span>
          </div>
        </div>

        <div className="flex items-center gap-[10px]">
          <div className="bg-surface flex items-center border border-[#282631] rounded-control p-[2px]">
            <button
              type="button"
              className={`supabase-view-btn items-center justify-center w-[28px] h-[28px] rounded-control-sm bg-transparent border-0 text-[#716f7c] cursor-pointer [transition:color_150ms,background-color_150ms] hover:text-ink-console ${viewMode === "grid" ? "is-active" : ""}`}
              onClick={() => setViewMode("grid")}
              aria-label="Grid view"
              title="Grid view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              className={`supabase-view-btn items-center justify-center w-[28px] h-[28px] rounded-control-sm bg-transparent border-0 text-[#716f7c] cursor-pointer [transition:color_150ms,background-color_150ms] hover:text-ink-console ${viewMode === "list" ? "is-active" : ""}`}
              onClick={() => setViewMode("list")}
              aria-label="List view"
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            className="supabase-btn-green"
            onClick={() => {
              setFormError("");
              setModalOpen(true);
            }}
            disabled={!canManage || atLimit}
            title={atLimit ? `Limit of ${limit} projects reached` : undefined}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>New project</span>
          </button>
        </div>
      </div>

      {/* Two Column Layout matching Image 2 */}
      <div className="supabase-projects-layout grid gap-[24px]">
        {/* Left / Main Column */}
        <div className="min-w-0">
          {projects.loading ? (
            <div className="supabase-projects-grid grid gap-[16px]">
              {[1, 2, 3].map((n) => (
                <div key={n} className="bg-surface flex flex-col justify-between p-[16px] rounded-card border border-surface-raised min-h-[120px]" aria-hidden="true">
                  <div className="flex items-start gap-[12px]">
                    <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] w-8 h-8 rounded-md" />
                    <div className="flex-1 space-y-2">
                      <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-4 rounded w-3/4" />
                      <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-3 rounded w-1/2" />
                    </div>
                  </div>
                  <div className="flex items-center gap-[12px] mt-[16px] pt-[12px] border-t border-t-[#232129] mt-4 pt-3 border-t border-zinc-800">
                    <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-3 rounded w-16" />
                    <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-3 rounded w-16" />
                  </div>
                </div>
              ))}
            </div>
          ) : projectList.length === 0 ? (
            /* Create a project Hero Box matching Image 2 */
            <div className="flex flex-col items-center justify-center text-center py-[64px] px-[32px] rounded-card bg-[#151419] border border-[#24222b]">
              <div className="flex items-center justify-center mb-[16px] text-[#6a6877]" aria-hidden="true">
                <Boxes className="w-10 h-10 text-zinc-400" />
              </div>
              <h2 className="text-[18px] font-semibold text-ink mt-0 mb-[6px] mx-0">Create a project</h2>
              <p className="text-[13px] text-[#83818e] mb-[20px]">Launch a complete backend built on Postgres.</p>
              <button
                type="button"
                className="inline-flex items-center gap-[8px] min-h-[38px] py-[8px] px-[18px] rounded-card border-0 bg-[var(--color-info)] [background-image:linear-gradient(180deg,var(--color-info)_0%,#056dff_100%)] [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.25),0_1px_3px_rgba(0,0,0,0.3),0_0_0_1px_#045ede] text-ink text-[13.5px]! font-medium! cursor-pointer whitespace-nowrap [transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:[background-image:linear-gradient(180deg,#4d92ff_0%,#0d73ff_100%)] [&:hover:not(:disabled)]:[box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.35),0_2px_6px_rgba(0,0,0,0.35),0_0_0_1px_#056dff] [&:hover:not(:disabled)]:text-ink [&:active:not(:disabled)]:translate-y-[1] disabled:opacity-[0.5] disabled:cursor-not-allowed disabled:transform-none disabled:[box-shadow:none]"
                onClick={() => setModalOpen(true)}
                disabled={!canManage || atLimit}
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>New project</span>
              </button>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="supabase-empty-filter-state">
              <p className="text-zinc-400">No projects match the query &ldquo;{search}&rdquo;.</p>
              <button
                type="button"
                className="supabase-btn-secondary font-medium focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] inline-flex items-center justify-center min-h-[38px] rounded-card border border-[#2a2834] bg-[#181720] [box-shadow:0_1px_2px_rgba(0,0,0,0.2)] whitespace-nowrap no-underline [transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease,color_120ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:border-[#3b3749] [&:hover:not(:disabled)]:bg-[#201e2a] [&:active:not(:disabled)]:translate-y-[1px] disabled:opacity-[0.5] disabled:transform-none mt-3"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                }}
              >
                Reset filters
              </button>
            </div>
          ) : viewMode === "grid" ? (
            /* Grid View */
            <div className="supabase-projects-grid grid gap-[16px]">
              {filteredProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/dashboard/projects/${project.id}`}
                  className="supabase-project-card bg-surface hover:bg-[#1a1920] flex flex-col justify-between p-[16px] rounded-card border border-surface-raised no-underline [transition:border-color_150ms,background-color_150ms] min-h-[120px] hover:border-[#373441]"
                >
                  <div className="flex items-start gap-[12px]">
                    <div className="flex items-center justify-center w-[32px] h-[32px] rounded-control bg-[#211f27] shrink-0">
                      <span className="font-bold text-sm text-emerald-400">
                        {project.name.slice(0, 1).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="truncate text-[15px] font-semibold text-ink m-0">{project.name}</h3>
                      <p className="truncate text-[12px] text-[#716f7c] [font-family:monospace] mt-[2px] mb-0 mx-0">{project.slug}</p>
                    </div>
                    <ArrowUpRight className="supabase-card-arrow w-[16px] h-[16px] text-[#555360] [transition:color_150ms,transform_150ms]" aria-hidden="true" />
                  </div>

                  <div className="flex items-center gap-[12px] mt-[16px] pt-[12px] border-t border-t-[#232129]">
                    <span className="flex items-center gap-[5px] text-[12px] text-[#8e8c99]">
                      <Layers className="w-3.5 h-3.5 text-zinc-500" />
                      <span>{project.serviceCount} Services</span>
                    </span>
                    <span className="flex items-center gap-[5px] text-[12px] text-[#8e8c99]">
                      <Database className="w-3.5 h-3.5 text-zinc-500" />
                      <span>{project.databaseCount} DB</span>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            /* List View */
            <div className="bg-surface border border-[var(--color-surface-raised)] rounded-card overflow-hidden">
              <table className="supabase-projects-list-table w-full text-[13px] text-left">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Services</th>
                    <th>Database</th>
                    <th>Status</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProjects.map((project) => (
                    <tr key={project.id}>
                      <td>
                        <Link
                          href={`/dashboard/projects/${project.id}`}
                          className="font-medium text-white hover:text-emerald-400 transition-colors"
                        >
                          {project.name}
                          <small className="block text-zinc-500 font-mono text-xs">
                            {project.slug}
                          </small>
                        </Link>
                      </td>
                      <td>{project.serviceCount}</td>
                      <td>
                        {project.databaseCount > 0
                          ? project.databaseEngine === "mysql"
                            ? "MySQL 8"
                            : "PostgreSQL 16"
                          : "None"}
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              project.status === "active" ? "bg-emerald-400" : "bg-zinc-600"
                            }`}
                          />
                          {project.status === "active" ? "Active" : "Empty"}
                        </span>
                      </td>
                      <td className="text-right">
                        <Link
                          href={`/dashboard/projects/${project.id}`}
                          className="text-xs text-zinc-400 hover:text-white inline-flex items-center gap-1"
                        >
                          <span>Open</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Column: Free Plan Usage Panel matching Image 2 */}
        <aside className="min-w-0" aria-label="Organization resource usage">
          <div className="bg-[#151419] border border-[#23212a] rounded-card p-[20px]">
            <div className="flex items-start justify-between gap-[12px] mb-[20px]">
              <div>
                <h3 className="text-[14px] font-semibold text-ink m-0">Free plan usage</h3>
                <p className="text-[12px] text-[#716f7c] mt-[2px]">Current billing cycle</p>
              </div>
              <button type="button" className="inline-flex items-center justify-center py-[5px] px-[12px] rounded-control bg-[#1c1b22] border border-[#302e3b] text-ink-console text-[12px]! font-medium! cursor-pointer [transition:background-color_150ms,border-color_150ms] whitespace-nowrap hover:bg-[#24232c] hover:border-[#3e3c4b]">
                Upgrade to Pro
              </button>
            </div>

            <div className="flex flex-col gap-[12px]">
              <div className="flex flex-col gap-[6px] py-[4px] px-[6px] rounded-control [transition:background-color_150ms] hover:bg-[rgba(255,255,255,0.02)]">
                <div className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-[8px]">
                    <Circle className="w-3 h-3 text-zinc-500" />
                    <span className="text-[#a19fa9]">Egress</span>
                  </div>
                  <span className="text-ink font-medium [font-family:inherit] text-[12px]">0 / 5 GB</span>
                </div>
                <div className="bg-[#211f2a] w-full h-[4px] rounded-[99px] overflow-hidden">
                  <div className="bg-accent h-full rounded-[99px] [transition:width_300ms_ease]" style={{ width: "0%" }} />
                </div>
              </div>

              <div className="flex flex-col gap-[6px] py-[4px] px-[6px] rounded-control [transition:background-color_150ms] hover:bg-[rgba(255,255,255,0.02)]">
                <div className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-[8px]">
                    <Circle className="w-3 h-3 text-zinc-500" />
                    <span className="text-[#a19fa9]">Database size</span>
                  </div>
                  <span className="text-ink font-medium [font-family:inherit] text-[12px]">
                    {totalDatabases > 0 ? `${totalDatabases * 10} / 500 MB` : "0 / 500 MB"}
                  </span>
                </div>
                <div className="bg-[#211f2a] w-full h-[4px] rounded-[99px] overflow-hidden">
                  <div
                    className="bg-accent h-full rounded-[99px] [transition:width_300ms_ease]"
                    style={{
                      width: `${Math.min(100, Math.round(((totalDatabases * 10) / 500) * 100))}%`,
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-[6px] py-[4px] px-[6px] rounded-control [transition:background-color_150ms] hover:bg-[rgba(255,255,255,0.02)]">
                <div className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-[8px]">
                    <Circle className="w-3 h-3 text-zinc-500" />
                    <span className="text-[#a19fa9]">Monthly active users</span>
                  </div>
                  <span className="text-ink font-medium [font-family:inherit] text-[12px]">0 / 50,000</span>
                </div>
                <div className="bg-[#211f2a] w-full h-[4px] rounded-[99px] overflow-hidden">
                  <div className="bg-accent h-full rounded-[99px] [transition:width_300ms_ease]" style={{ width: "0%" }} />
                </div>
              </div>

              <div className="flex flex-col gap-[6px] py-[4px] px-[6px] rounded-control [transition:background-color_150ms] hover:bg-[rgba(255,255,255,0.02)]">
                <div className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-[8px]">
                    <Circle className="w-3 h-3 text-zinc-500" />
                    <span className="text-[#a19fa9]">File storage</span>
                  </div>
                  <span className="text-ink font-medium [font-family:inherit] text-[12px]">0 / 1 GB</span>
                </div>
                <div className="bg-[#211f2a] w-full h-[4px] rounded-[99px] overflow-hidden">
                  <div className="bg-accent h-full rounded-[99px] [transition:width_300ms_ease]" style={{ width: "0%" }} />
                </div>
              </div>

              <div className="flex flex-col gap-[6px] py-[4px] px-[6px] rounded-control [transition:background-color_150ms] hover:bg-[rgba(255,255,255,0.02)]">
                <div className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-[8px]">
                    <Circle className="w-3 h-3 text-zinc-500" />
                    <span className="text-[#a19fa9]">Log Ingestion</span>
                  </div>
                  <span className="text-ink font-medium [font-family:inherit] text-[12px]">0 / 1 GB</span>
                </div>
                <div className="bg-[#211f2a] w-full h-[4px] rounded-[99px] overflow-hidden">
                  <div className="bg-accent h-full rounded-[99px] [transition:width_300ms_ease]" style={{ width: "0%" }} />
                </div>
              </div>

              <div className="flex flex-col gap-[6px] py-[4px] px-[6px] rounded-control [transition:background-color_150ms] hover:bg-[rgba(255,255,255,0.02)]">
                <div className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-[8px]">
                    <Circle className="w-3 h-3 text-zinc-500" />
                    <span className="text-[#a19fa9]">Log Query</span>
                  </div>
                  <span className="text-ink font-medium [font-family:inherit] text-[12px]">0 / 100 GB</span>
                </div>
                <div className="bg-[#211f2a] w-full h-[4px] rounded-[99px] overflow-hidden">
                  <div className="bg-accent h-full rounded-[99px] [transition:width_300ms_ease]" style={{ width: "0%" }} />
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Modal: Create Project */}
      {modalOpen && (
        <ModalDialog labelledBy="create-project-title" onClose={() => setModalOpen(false)}>
          <div className="supabase-modal-header flex items-center justify-between py-[18px] px-[20px]">
            <h2 id="create-project-title">Create a new project</h2>
            <button
              type="button"
              className="supabase-modal-close flex items-center justify-center w-[28px] h-[28px] rounded-control bg-transparent border-0 text-[#716f7c] cursor-pointer [transition:color_150ms,background-color_150ms] hover:text-ink-console"
              onClick={() => setModalOpen(false)}
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleCreateProject}>
            <div className="supabase-modal-body">
              <p className="text-sm text-zinc-400 mb-4">
                Each project provides an isolated environment for your services and a dedicated
                PostgreSQL or MySQL database.
              </p>

              <div className="mb-4">
                <label htmlFor="project-name-input" className="block text-[13px] font-medium text-[#c9c7d2] mb-[6px]">
                  Project name
                </label>
                <input
                  id="project-name-input"
                  type="text"
                  required
                  placeholder="e.g. My Next.js Backend"
                  maxLength={80}
                  value={name}
                  onChange={(event) => {
                    const value = event.target.value;
                    setName(value);
                    if (!slugEdited) setSlug(slugify(value));
                  }}
                  className="supabase-modal-input w-full h-[38px] py-0 px-[12px] rounded-control bg-[#1a1920] text-ink outline-none [transition:border-color_150ms]"
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="project-slug-input" className="block text-[13px] font-medium text-[#c9c7d2] mb-[6px]">
                  Slug identifier
                </label>
                <input
                  id="project-slug-input"
                  type="text"
                  maxLength={MAX_SLUG_LENGTH}
                  placeholder="my-next-backend"
                  value={slug}
                  onChange={(event) => {
                    setSlugEdited(true);
                    setSlug(event.target.value);
                  }}
                  className="supabase-modal-input w-full h-[38px] py-0 px-[12px] rounded-control bg-[#1a1920] text-ink outline-none [transition:border-color_150ms] font-mono text-sm"
                />
                <p className="text-xs text-zinc-500 mt-1">
                  Used in service domain names and internal routing.
                </p>
              </div>

              {formError && <p className="text-xs text-rose-400 mt-3">{formError}</p>}
            </div>

            <div className="supabase-modal-footer">
              <button
                type="button"
                className="supabase-btn-secondary font-medium focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] inline-flex items-center justify-center min-h-[38px] rounded-card border border-[#2a2834] bg-[#181720] [box-shadow:0_1px_2px_rgba(0,0,0,0.2)] whitespace-nowrap no-underline [transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease,color_120ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:border-[#3b3749] [&:hover:not(:disabled)]:bg-[#201e2a] [&:active:not(:disabled)]:translate-y-[1px] disabled:opacity-[0.5] disabled:transform-none"
                onClick={() => setModalOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" className="supabase-btn-green" disabled={busy || !name.trim()}>
                {busy ? "Creating..." : "Create project"}
              </button>
            </div>
          </form>
        </ModalDialog>
      )}
    </div>
  );
}
