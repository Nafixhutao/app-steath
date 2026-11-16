"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActiveMember } from "@/lib/auth-client";
import {
  deleteProject,
  getProject,
  updateProject,
  type ProjectSummary,
} from "@/lib/projects-client";
import { getError, useResource } from "@/lib/resource";
import { ServicesPanel } from "./services-panel";
import { DatabasePanel } from "./database-panel";

export function ProjectDetail({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { data: activeMember } = useActiveMember();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  // Rename and delete failures share one slot next to the load error.
  const [actionError, setActionError] = useState("");
  // Null means the edit form follows the server values; typing detaches it.
  const [draft, setDraft] = useState<{ name: string; slug: string } | null>(null);
  const canManage = activeMember?.role === "owner" || activeMember?.role === "admin";

  const panel = useResource(() => getProject(projectId), [projectId]);
  const project: ProjectSummary | null = panel.data;
  const loading = panel.loading;
  const error = panel.error;
  const name = draft?.name ?? project?.name ?? "";
  const slug = draft?.slug ?? project?.slug ?? "";

  /**
   * Refreshes only the Project summary so Service counts stay accurate after a
   * Service is created or deleted, without resetting the edit form.
   */
  const refreshSummary = panel.refresh;

  async function rename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    setActionError("");
    try {
      const updated = await updateProject(projectId, {
        name: name.trim(),
        slug: slug.trim(),
      });
      // Adopt the saved values and re-attach the form to the server state.
      panel.setData(updated);
      setDraft(null);
      setNotice("Project updated.");
    } catch (cause) {
      setNotice("");
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
      router.push("/dashboard/projects");
    } catch (cause) {
      setActionError(getError(cause));
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="dashboard-content">
        <div role="status" aria-label="Loading project">
          <div className="dashboard-heading-skeleton" />
          <div className="dashboard-heading-skeleton short" />
          <div className="dashboard-skeleton">
            <div className="dashboard-skeleton-row" />
            <div className="dashboard-skeleton-row" />
            <div className="dashboard-skeleton-row" />
          </div>
          <span className="sr-only">Loading Project…</span>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="dashboard-content">
        <div className="dashboard-page-heading">
          <div>
            <h1>Project not found</h1>
            <p>This Project does not exist in the active Organization.</p>
          </div>
        </div>
        {error || actionError ? (
          <p className="dashboard-alert is-error" role="alert">
            {error || actionError}
          </p>
        ) : null}
        <p className="dashboard-back-link">
          <Link href="/dashboard/projects">Back to Projects</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      <div className="dashboard-page-heading">
        <div>
          <p className="dashboard-breadcrumb">
            <Link href="/dashboard/projects">Projects</Link> / {project.name}
          </p>
          <h1>{project.name}</h1>
          <p>
            <code className="project-slug">{project.slug}</code>
          </p>
        </div>
        <span
          className={`dashboard-status ${project.status === "empty" ? "is-idle" : "is-active"}`}
        >
          <span className="dashboard-status-dot" aria-hidden="true" />
          {project.status === "empty" ? "Empty" : "Active"}
        </span>
      </div>

      {error || actionError ? (
        <p className="dashboard-alert is-error" role="alert">
          {error || actionError}
        </p>
      ) : null}
      {notice ? (
        <p className="dashboard-alert is-success" role="status">
          {notice}
        </p>
      ) : null}

      <section className="dashboard-section" aria-labelledby="resources-heading">
        <div className="dashboard-section-heading">
          <h2 id="resources-heading">Resources</h2>
        </div>
        <div className="project-resource-counts">
          <div>
            <strong>{project.serviceCount}</strong>
            <span>Services</span>
          </div>
          <div>
            <strong>{project.databaseCount}</strong>
            <span>Databases</span>
          </div>
        </div>
      </section>

      <ServicesPanel
        projectId={project.id}
        canManage={canManage}
        onChanged={() => void refreshSummary()}
      />

      <DatabasePanel projectId={project.id} projectName={project.name} canManage={canManage} />

      {canManage ? (
        <section className="dashboard-section" aria-labelledby="settings-heading">
          <div className="dashboard-section-heading">
            <h2 id="settings-heading">Settings</h2>
          </div>
          <form className="organization-settings-form" onSubmit={rename}>
            <label>
              Project name
              <input
                value={name}
                maxLength={80}
                required
                onChange={(event) => setDraft({ name: event.target.value, slug })}
              />
            </label>
            <label>
              Slug
              <input
                value={slug}
                maxLength={40}
                required
                onChange={(event) => setDraft({ name, slug: event.target.value })}
              />
            </label>
            <button
              className="create-project-button"
              type="submit"
              disabled={
                busy ||
                !name.trim() ||
                !slug.trim() ||
                (name.trim() === project.name && slug.trim() === project.slug)
              }
            >
              {busy ? "Saving..." : "Save changes"}
            </button>
          </form>
        </section>
      ) : (
        <section className="dashboard-section" aria-labelledby="settings-heading">
          <div className="dashboard-section-heading">
            <h2 id="settings-heading">Settings</h2>
          </div>
          <p className="settings-readonly">Only an owner or admin can rename this Project.</p>
        </section>
      )}

      {canManage ? (
        <section
          className="dashboard-section organization-danger-zone"
          aria-labelledby="danger-heading"
        >
          <div className="dashboard-section-heading">
            <h2 id="danger-heading">Danger zone</h2>
          </div>
          <p>
            Deleting this Project permanently removes its Services, Databases, Volumes, Domains, and
            Backups.
          </p>
          <form className="organization-settings-form" onSubmit={remove}>
            <label>
              Type <strong>{project.name}</strong> to confirm
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                required
              />
            </label>
            <button
              className="dashboard-danger-button"
              type="submit"
              disabled={busy || confirmation !== project.name}
            >
              {busy ? "Deleting..." : "Delete Project"}
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
