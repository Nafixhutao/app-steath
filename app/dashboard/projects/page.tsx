"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useActiveMember, useActiveOrganization } from "@/lib/auth-client";
import { createProject, listProjects, type ProjectSummary } from "@/lib/projects-client";
import { QUOTAS } from "@/lib/platform/quota-limits";
import { MAX_SLUG_LENGTH, slugify } from "@/lib/slug";

function getError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function statusLabel(project: ProjectSummary) {
  const total = project.serviceCount + project.databaseCount;
  if (total === 0) return "No resources yet";
  return `${total} resource${total === 1 ? "" : "s"}`;
}

export default function ProjectsPage() {
  const { data: organization } = useActiveOrganization();
  const { data: activeMember } = useActiveMember();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const organizationId = organization?.id;
  const canManage = activeMember?.role === "owner" || activeMember?.role === "admin";
  const limit = QUOTAS.projectsPerOrganization;
  const atLimit = projects.length >= limit;

  const refresh = useCallback(async () => {
    if (!organizationId) return;
    try {
      setProjects(await listProjects());
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createProject({ name: name.trim(), slug: slug.trim() || undefined });
      setName("");
      setSlug("");
      setSlugEdited(false);
      await refresh();
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dashboard-content">
      <div className="dashboard-page-heading">
        <div>
          <h1>Projects</h1>
          <p>
            Projects group Services and a PostgreSQL Database within{" "}
            {organization?.name ?? "this Organization"}.
          </p>
        </div>
        <span className="project-quota">
          {projects.length} of {limit} Projects
        </span>
      </div>

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
        </p>
      ) : null}

      {canManage ? (
        <section className="dashboard-section" aria-labelledby="create-project-heading">
          <div className="dashboard-section-heading">
            <h2 id="create-project-heading">Create a Project</h2>
          </div>
          <form className="organization-settings-form" onSubmit={submit}>
            <label>
              Project name
              <input
                value={name}
                maxLength={80}
                required
                onChange={(event) => {
                  const value = event.target.value;
                  setName(value);
                  if (!slugEdited) setSlug(slugify(value));
                }}
              />
            </label>
            <label>
              Slug
              <input
                value={slug}
                maxLength={MAX_SLUG_LENGTH}
                placeholder="my-project"
                onChange={(event) => {
                  setSlugEdited(true);
                  setSlug(event.target.value);
                }}
              />
            </label>
            <button
              className="create-project-button"
              type="submit"
              disabled={busy || atLimit || !name.trim()}
            >
              {busy ? "Creating..." : "Create Project"}
            </button>
          </form>
          {atLimit ? (
            <p className="project-quota-note">
              This Organization has reached its Quota of {limit} Projects. Delete a Project to
              create another one.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="dashboard-section" aria-labelledby="project-list-heading">
        <div className="dashboard-section-heading">
          <h2 id="project-list-heading">
            Projects <span className="dashboard-count">{projects.length}</span>
          </h2>
        </div>

        {loading ? (
          <p className="dashboard-table-empty" role="status">
            Loading Projects...
          </p>
        ) : projects.length === 0 ? (
          <div className="dashboard-empty-state">
            <h3>No Projects yet</h3>
            <p>
              {canManage
                ? "Create a Project to deploy a Service or provision a PostgreSQL Database."
                : "An owner or admin can create the first Project in this Organization."}
            </p>
          </div>
        ) : (
          <div className="project-grid">
            {projects.map((project) => (
              <Link
                key={project.id}
                className="project-card project-card-link"
                href={`/dashboard/projects/${project.id}`}
              >
                <span className="project-card-mark green" aria-hidden="true">
                  {project.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="project-card-copy">
                  <h2>{project.name}</h2>
                  <p>{project.slug}</p>
                </div>
                <div className="project-card-footer">
                  <span>
                    <strong>{project.serviceCount}</strong> Services
                  </span>
                  <span>
                    <strong>{project.databaseCount}</strong> Databases
                  </span>
                  <time dateTime={new Date(project.updatedAt).toISOString()}>
                    {statusLabel(project)}
                  </time>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
