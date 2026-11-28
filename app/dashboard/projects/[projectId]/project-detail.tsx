"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Container,
  Database,
  HardDrive,
  Settings,
  Copy,
  Check,
  ChevronRight,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useActiveMember } from "@/lib/auth-client";
import {
  deleteProject,
  getProject,
  updateProject,
  type ProjectSummary,
} from "@/lib/projects-client";
import { getError, useResource } from "@/lib/resource";
import { useToast } from "@/components/toast-context";
import { ServicesPanel } from "./services-panel";
import { DatabasePanel } from "./database-panel";
import { StoragePanel } from "./storage-panel";

import { dangerButtonClass, secondaryButtonClass } from "@/components/ui-classes";

type ProjectTab = "services" | "database" | "storage" | "settings";

/**
 * The Project summary may gain a Storage bucket count before this panel does;
 * reading it optionally keeps the tab honest without changing the client type.
 */
type ProjectWithStorageCount = ProjectSummary & { storageBucketCount?: number };

/** The engine named in the Project header, or `No Database` when there is none. */
function databaseLabel(engine: string | null, count: number): string {
  if (count === 0) {
    return "No Database";
  }

  return engine === "mysql" ? "MySQL 8" : "PostgreSQL 16";
}

export function ProjectDetail({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { data: activeMember } = useActiveMember();

  const [activeTab, setActiveTab] = useState<ProjectTab>("services");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState(false);

  // Rename and delete failures share one slot next to the load error.
  const [actionError, setActionError] = useState("");
  // Null means the edit form follows the server values; typing detaches it.
  const [draft, setDraft] = useState<{ name: string; slug: string } | null>(null);
  // Better Auth stores multiple roles as a comma-separated string, so check the
  // parsed set rather than the raw value.
  const canManage =
    activeMember?.role
      .split(",")
      .some((role) => role.trim() === "owner" || role.trim() === "admin") ?? false;

  const panel = useResource(() => getProject(projectId), [projectId]);
  const project: ProjectSummary | null = panel.data;
  const loading = panel.loading;
  const error = panel.error;
  const name = draft?.name ?? project?.name ?? "";
  const slug = draft?.slug ?? project?.slug ?? "";
  const storageBucketCount =
    (project as ProjectWithStorageCount | null)?.storageBucketCount ?? 0;

  const refreshSummary = panel.refresh;

  function copySlug(text: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(() => {
        setCopiedSlug(true);
        toast.success("Copied slug to clipboard", text);
        setTimeout(() => setCopiedSlug(false), 2000);
      });
    }
  }

  async function rename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setActionError("");
    try {
      const updated = await updateProject(projectId, {
        name: name.trim(),
        slug: slug.trim(),
      });
      panel.setData(updated);
      setDraft(null);
      toast.success("Project updated", "Name and slug changes saved.");
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setActionError("");
    try {
      await deleteProject(projectId, confirmation);
      toast.success("Project deleted", `"${project?.name}" has been removed.`);
      router.push("/dashboard/projects");
    } catch (cause) {
      setActionError(getError(cause));
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="pt-[24px] pb-[64px] px-[32px] max-w-[1300px] my-0 mx-auto w-full">
        <div className="project-detail-header-skeleton" aria-label="Loading project">
          <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-4 w-40 rounded mb-4" />
          <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-8 w-64 rounded mb-2" />
          <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-4 w-32 rounded" />
        </div>
        <div className="project-tabs-skeleton mt-6">
          <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-10 w-80 rounded-lg mb-6" />
          <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="pt-[24px] pb-[64px] px-[32px] max-w-[1300px] my-0 mx-auto w-full">
        <div className="project-empty-state">
          <Boxes className="w-12 h-12 text-zinc-600 mb-3" />
          <h2>Project not found</h2>
          <p className="text-zinc-400 text-sm mt-1 mb-4">
            This project does not exist in the active organization or you do not have permission to
            view it.
          </p>
          <Link href="/dashboard/projects" className={secondaryButtonClass}>
            Back to Projects
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-[24px] pb-[64px] px-[32px] max-w-[1300px] my-0 mx-auto w-full">
      {/* Top Header */}
      <header className="border-b border-[#23222a] pb-0 mb-[24px]">
        <nav className="flex items-center gap-[8px] text-[13px] mb-[14px]" aria-label="Breadcrumb">
          <Link href="/dashboard/projects" className="text-[#8e8c99] hover:text-ink-console no-underline [transition:color_150ms]">
            Projects
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-zinc-600" aria-hidden="true" />
          <span className="text-ink-console font-medium">{project.name}</span>
        </nav>

        <div className="flex items-center justify-between flex-wrap gap-[16px] mb-[22px]">
          <div className="flex items-center gap-[14px]">
            <div className="flex items-center justify-center w-[44px] h-[44px] rounded-panel bg-[#1a1922] border border-[#2a2736] shrink-0" aria-hidden="true">
              <Boxes className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-[24px] font-semibold! tracking-[-0.02em]! text-ink m-0 leading-[1.2]!">{project.name}</h1>
                <span
                  className={`project-status-pill inline-flex items-center gap-[6px] text-[11px] font-medium py-[2px] px-[8px] rounded-[99px] border ${
                    project.status === "active" ? "bg-[rgba(62,207,142,0.1)] border-[rgba(62,207,142,0.25)] text-[var(--color-accent)]" : "bg-[rgba(255,255,255,0.05)] border-[#2a2835] text-[#9e9aa8]"
                  }`}
                >
                  <span className={`project-status-dot bg-current w-[6px] h-[6px] rounded-[50%] ${project.status === "active" ? "[box-shadow:0_0_8px_rgba(62,207,142,0.6)]" : ""}`} aria-hidden="true" />
                  {project.status === "active" ? "Active" : "Empty"}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <code className="text-[12px] [font-family:monospace] text-[#716f7c] bg-[#17161c] py-[1px] px-[6px] rounded-control-sm border border-[#262430]">{project.slug}</code>
                <button
                  type="button"
                  className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-control-sm bg-transparent border border-transparent text-[#716f7c] cursor-pointer [transition:all_120ms] hover:bg-[#211f29] hover:border-[#312f3d] hover:text-ink-console"
                  onClick={() => copySlug(project.slug)}
                  title="Copy project slug"
                  aria-label="Copy project slug"
                >
                  {copiedSlug ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3 text-zinc-500" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-[8px]">
            <div className="bg-surface flex items-center gap-[6px] text-[12px] py-[4px] px-[10px] rounded-control border border-surface-raised text-[#8e8c99]">
              <Container className="w-3.5 h-3.5 text-zinc-400" />
              <span>{project.serviceCount} Services</span>
            </div>
            <div className="bg-surface flex items-center gap-[6px] text-[12px] py-[4px] px-[10px] rounded-control border border-surface-raised text-[#8e8c99]">
              <Database className="w-3.5 h-3.5 text-zinc-400" />
              <span>{databaseLabel(project.databaseEngine, project.databaseCount)}</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-[4px] mt-[8px]" role="tablist" aria-label="Project sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "services"}
            aria-controls="panel-services"
            id="tab-services"
            className={`project-tab-button inline-flex items-center gap-[8px] h-[38px] py-0 px-[14px] text-[13px] font-medium bg-transparent border-0 border-b-2 cursor-pointer [transition:color_150ms,border-color_150ms] ${activeTab === "services" ? "text-[var(--color-ink)] border-b-[var(--color-accent)]" : "text-[#8e8c99] border-b-transparent hover:text-ink-console"}`}
            onClick={() => setActiveTab("services")}
          >
            <Container className="w-4 h-4" />
            <span>Services</span>
            <span className="text-[11px] py-[1px] px-[6px] rounded-[99px] bg-[#22202a] text-[#a19fa9]">{project.serviceCount}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "database"}
            aria-controls="panel-database"
            id="tab-database"
            className={`project-tab-button inline-flex items-center gap-[8px] h-[38px] py-0 px-[14px] text-[13px] font-medium bg-transparent border-0 border-b-2 cursor-pointer [transition:color_150ms,border-color_150ms] ${activeTab === "database" ? "text-[var(--color-ink)] border-b-[var(--color-accent)]" : "text-[#8e8c99] border-b-transparent hover:text-ink-console"}`}
            onClick={() => setActiveTab("database")}
          >
            <Database className="w-4 h-4" />
            <span>Database</span>
            <span
              className={`project-tab-status-dot w-[7px] h-[7px] rounded-[50%] ${
                project.databaseCount > 0 ? "bg-[var(--color-accent)] [box-shadow:0_0_6px_rgba(62,207,142,0.6)]" : "bg-[#555360]"
              }`}
              title={project.databaseCount > 0 ? "Provisioned" : "None"}
            />
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "storage"}
            aria-controls="panel-storage"
            id="tab-storage"
            className={`project-tab-button inline-flex items-center gap-[8px] h-[38px] py-0 px-[14px] text-[13px] font-medium bg-transparent border-0 border-b-2 cursor-pointer [transition:color_150ms,border-color_150ms] ${activeTab === "storage" ? "text-[var(--color-ink)] border-b-[var(--color-accent)]" : "text-[#8e8c99] border-b-transparent hover:text-ink-console"}`}
            onClick={() => setActiveTab("storage")}
          >
            <HardDrive className="w-4 h-4" />
            <span>Storage</span>
            <span
              className={`project-tab-status-dot w-[7px] h-[7px] rounded-[50%] ${
                storageBucketCount > 0 ? "bg-[var(--color-accent)] [box-shadow:0_0_6px_rgba(62,207,142,0.6)]" : "bg-[#555360]"
              }`}
              title={storageBucketCount > 0 ? "Provisioned" : "None"}
            />
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "settings"}
            aria-controls="panel-settings"
            id="tab-settings"
            className={`project-tab-button inline-flex items-center gap-[8px] h-[38px] py-0 px-[14px] text-[13px] font-medium bg-transparent border-0 border-b-2 cursor-pointer [transition:color_150ms,border-color_150ms] ${activeTab === "settings" ? "text-[var(--color-ink)] border-b-[var(--color-accent)]" : "text-[#8e8c99] border-b-transparent hover:text-ink-console"}`}
            onClick={() => setActiveTab("settings")}
          >
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>
        </div>
      </header>

      {/* Global Alerts */}
      {error || actionError ? (
        <div className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error my-4" role="alert">
          {error || actionError}
        </div>
      ) : null}

      {/* Tab Panels */}
      <main className="min-h-[400px]">
        {activeTab === "services" && (
          <div id="panel-services" role="tabpanel" aria-labelledby="tab-services">
            <ServicesPanel
              projectId={project.id}
              canManage={canManage}
              onChanged={() => void refreshSummary()}
            />
          </div>
        )}

        {activeTab === "database" && (
          <div id="panel-database" role="tabpanel" aria-labelledby="tab-database">
            <DatabasePanel
              projectId={project.id}
              projectName={project.name}
              canManage={canManage}
              onChanged={() => void refreshSummary()}
            />
          </div>
        )}

        {activeTab === "storage" && (
          <div id="panel-storage" role="tabpanel" aria-labelledby="tab-storage">
            <StoragePanel projectId={project.id} canManage={canManage} />
          </div>
        )}

        {activeTab === "settings" && (
          <div
            id="panel-settings"
            role="tabpanel"
            aria-labelledby="tab-settings"
            className="space-y-6"
          >
            {/* General Settings */}
            <div className="bg-surface rounded-card border border-surface-raised overflow-hidden">
              <div className="flex items-center justify-between py-[16px] px-[20px] border-b border-b-[#23212a]">
                <div>
                  <h2 className="text-[14.5px] font-semibold text-ink m-0">General Settings</h2>
                  <p className="text-[12px] text-[#716f7c] mt-[3px] mb-0 mx-0">
                    Update the project display name and unique URL slug identifier.
                  </p>
                </div>
              </div>

              {canManage ? (
                <form onSubmit={rename} className="p-[20px]">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="edit-project-name" className="block text-[12.5px] font-medium text-[#c9c7d2] mb-[6px]">
                        Project Name
                      </label>
                      <input
                        id="edit-project-name"
                        value={name}
                        maxLength={80}
                        required
                        onChange={(e) => setDraft({ name: e.target.value, slug })}
                        className="project-form-input bg-[#1a1920] w-full h-[38px] py-0 px-[12px] rounded-control text-ink text-[13px]! outline-none [transition:border-color_150ms]"
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-project-slug" className="block text-[12.5px] font-medium text-[#c9c7d2] mb-[6px]">
                        Project Slug
                      </label>
                      <input
                        id="edit-project-slug"
                        value={slug}
                        maxLength={40}
                        required
                        onChange={(e) => setDraft({ name, slug: e.target.value })}
                        className="project-form-input bg-[#1a1920] w-full h-[38px] py-0 px-[12px] rounded-control text-ink text-[13px]! outline-none [transition:border-color_150ms] font-mono text-sm"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end py-[14px] px-[20px] bg-[#141318] border-t border-t-[#23212a] mt-[20px]">
                    <button
                      type="submit"
                      className="supabase-btn-green"
                      disabled={
                        busy ||
                        !name.trim() ||
                        !slug.trim() ||
                        (name.trim() === project.name && slug.trim() === project.slug)
                      }
                    >
                      {busy ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                          Saving...
                        </>
                      ) : (
                        "Save Changes"
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                <p className="text-zinc-500 text-sm p-5">
                  Only an owner or admin can rename this Project.
                </p>
              )}
            </div>

            {/* Danger Zone */}
            {canManage && (
              <div className="bg-surface rounded-card border border-[rgba(244,63,94,0.25)] overflow-hidden">
                <div className="bg-[rgba(244,63,94,0.03)] py-[16px] px-[20px] border-b border-b-[rgba(244,63,94,0.15)]">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-rose-400" />
                    <h2 className="text-[14.5px] font-semibold text-[var(--color-danger)] m-0">Delete Project</h2>
                  </div>
                  <p className="text-[12px] text-[#9e9aa8] mt-[4px] mb-0 mx-0">
                    Permanently delete this project and all associated services, database records,
                    persistent volumes, and backups. This action cannot be undone.
                  </p>
                </div>

                <form onSubmit={remove} className="p-[20px]">
                  <div className="max-w-md">
                    <label htmlFor="delete-confirm-input" className="block text-[12.5px] font-medium text-[#c9c7d2] mb-[6px]">
                      Type <strong>{project.name}</strong> to confirm deletion
                    </label>
                    <input
                      id="delete-confirm-input"
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                      placeholder={project.name}
                      autoComplete="off"
                      required
                      className="project-form-input bg-[#1a1920] w-full h-[38px] py-0 px-[12px] rounded-control text-ink text-[13px]! outline-none [transition:border-color_150ms] border-rose-900/50 focus:border-rose-500"
                    />
                  </div>

                  <div className="bg-[#141318] flex items-center justify-end py-[14px] px-[20px] border-t border-t-[rgba(244,63,94,0.15)] mt-[20px]">
                    <button
                      type="submit"
                      className={dangerButtonClass}
                      disabled={busy || confirmation !== project.name}
                    >
                      {busy ? "Deleting..." : "Delete Project Permanently"}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
