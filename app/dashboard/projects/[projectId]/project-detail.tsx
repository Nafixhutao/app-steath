"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActiveMember } from "@/lib/auth-client";
import {
  deleteProject,
  getProject,
  updateProject,
  type ProjectSummary,
} from "@/lib/projects-client";

function getError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

export function ProjectDetail({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { data: activeMember } = useActiveMember();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canManage = activeMember?.role === "owner" || activeMember?.role === "admin";

  const load = useCallback(async () => {
    try {
      const result = await getProject(projectId);
      setProject(result);
      setName(result.name);
      setSlug(result.slug);
      setError("");
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function rename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await updateProject(projectId, {
        name: name.trim(),
        slug: slug.trim(),
      });
      setProject(updated);
      setName(updated.name);
      setSlug(updated.slug);
      setNotice("Project updated.");
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await deleteProject(projectId, confirmation);
      router.push("/dashboard/projects");
    } catch (cause) {
      setError(getError(cause));
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="dashboard-content">
        <p className="dashboard-table-empty" role="status">
          Loading Project...
        </p>
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
        {error ? (
          <p className="dashboard-alert is-error" role="alert">
            {error}
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
        <span className="role-label">{project.status === "empty" ? "Empty" : "Active"}</span>
      </div>

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
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
        <div className="dashboard-empty-state">
          <h3>No resources yet</h3>
          <p>
            Services and Databases for this Project are added in the next steps of the platform
            build.
          </p>
        </div>
      </section>

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
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Slug
              <input
                value={slug}
                maxLength={40}
                required
                onChange={(event) => setSlug(event.target.value)}
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
