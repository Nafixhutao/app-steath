"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActiveMember } from "@/lib/auth-client";
import { getProject } from "@/lib/projects-client";
import {
  deleteService,
  getService,
  serviceStatusLabel,
  type ServiceSummary,
} from "@/lib/services-client";
import { DeploymentsPanel } from "./deployments-panel";
import { EnvironmentPanel } from "./environment-panel";
import { RuntimePanel } from "./runtime-panel";

function getError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

export function ServiceDetail({ serviceId }: { serviceId: string }) {
  const router = useRouter();
  const { data: activeMember } = useActiveMember();
  const [service, setService] = useState<ServiceSummary | null>(null);
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canManage = activeMember?.role === "owner" || activeMember?.role === "admin";
  // Members are read-only for resources but may still trigger a Deployment.
  const canDeploy = Boolean(activeMember?.role);

  const load = useCallback(async () => {
    try {
      const result = await getService(serviceId);
      setService(result);
      setError("");
      // The Project name only decorates the breadcrumb; a failure here must not
      // hide the Service itself.
      void getProject(result.projectId)
        .then((project) => setProjectName(project.name))
        .catch(() => undefined);
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function remove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!service) return;
    setBusy(true);
    setError("");
    try {
      await deleteService(service.id, confirmation);
      router.push(`/dashboard/projects/${service.projectId}`);
    } catch (cause) {
      setError(getError(cause));
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="dashboard-content">
        <p className="dashboard-table-empty" role="status">
          Loading Service...
        </p>
      </div>
    );
  }

  if (!service) {
    return (
      <div className="dashboard-content">
        <div className="dashboard-page-heading">
          <div>
            <h1>Service not found</h1>
            <p>This Service does not exist in the active Organization.</p>
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
            <Link href="/dashboard/projects">Projects</Link> /{" "}
            <Link href={`/dashboard/projects/${service.projectId}`}>
              {projectName || "Project"}
            </Link>{" "}
            / {service.name}
          </p>
          <h1>{service.name}</h1>
          <p>
            <a className="service-url" href={service.url} target="_blank" rel="noreferrer">
              {service.platformHostname}
            </a>
          </p>
        </div>
        <span className="role-label">{serviceStatusLabel(service.status)}</span>
      </div>

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="dashboard-section" aria-labelledby="configuration-heading">
        <div className="dashboard-section-heading">
          <h2 id="configuration-heading">Configuration</h2>
        </div>
        <dl className="service-meta">
          <div>
            <dt>Repository</dt>
            <dd>
              {service.repoUrl} @ {service.branch}
            </dd>
          </div>
          <div>
            <dt>Dockerfile</dt>
            <dd>{service.dockerfilePath}</dd>
          </div>
          <div>
            <dt>Container port</dt>
            <dd>{service.containerPort}</dd>
          </div>
          <div>
            <dt>Health path</dt>
            <dd>{service.healthPath ?? "None"}</dd>
          </div>
          <div>
            <dt>Platform Subdomain</dt>
            <dd>{service.platformHostname}</dd>
          </div>
          <div>
            <dt>Resource limits</dt>
            <dd>
              {service.cpuLimit} vCPU · {service.memoryLimitMb} MB RAM
            </dd>
          </div>
        </dl>
      </section>

      <DeploymentsPanel serviceId={service.id} canDeploy={canDeploy} canManage={canManage} />

      {canManage ? (
        <EnvironmentPanel serviceId={service.id} needsRedeploy={service.needsRedeploy} />
      ) : null}

      <RuntimePanel
        serviceId={service.id}
        canManage={canManage}
        hostname={service.platformHostname}
      />

      {canManage ? (
        <section
          className="dashboard-section organization-danger-zone"
          aria-labelledby="danger-heading"
        >
          <div className="dashboard-section-heading">
            <h2 id="danger-heading">Danger zone</h2>
          </div>
          <p>
            Deleting this Service stops its container and removes its Volume, Environment Variables,
            and Domains.
          </p>
          <form className="organization-settings-form" onSubmit={remove}>
            <label>
              Type <strong>{service.name}</strong> to confirm
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
              disabled={busy || confirmation !== service.name}
            >
              {busy ? "Deleting..." : "Delete Service"}
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
