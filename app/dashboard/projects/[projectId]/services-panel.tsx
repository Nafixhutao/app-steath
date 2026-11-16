"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  createService,
  deleteService,
  listServices,
  serviceStatusLabel,
  type ServiceSummary,
} from "@/lib/services-client";
import { QUOTAS } from "@/lib/platform/quota-limits";

function getError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

const EMPTY_FORM = {
  name: "",
  repoUrl: "",
  branch: "main",
  dockerfilePath: "Dockerfile",
  containerPort: "3000",
  healthPath: "",
};

export function ServicesPanel({
  projectId,
  canManage,
  onChanged,
}: {
  projectId: string;
  canManage: boolean;
  onChanged?: () => void;
}) {
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmations, setConfirmations] = useState<Record<string, string>>({});

  const limit = QUOTAS.servicesPerProject;
  const atLimit = services.length >= limit;

  const refresh = useCallback(async () => {
    try {
      setServices(await listServices(projectId));
      setError("");
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  function update<K extends keyof typeof EMPTY_FORM>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createService(projectId, {
        name: form.name.trim(),
        repoUrl: form.repoUrl.trim(),
        branch: form.branch.trim() || undefined,
        dockerfilePath: form.dockerfilePath.trim() || undefined,
        containerPort: form.containerPort.trim() ? Number(form.containerPort) : undefined,
        healthPath: form.healthPath.trim() || undefined,
      });
      setForm(EMPTY_FORM);
      await refresh();
      onChanged?.();
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(service: ServiceSummary) {
    setBusy(true);
    setError("");
    try {
      await deleteService(service.id, confirmations[service.id] ?? "");
      setConfirmations((current) => ({ ...current, [service.id]: "" }));
      await refresh();
      onChanged?.();
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dashboard-section" aria-labelledby="services-heading">
      <div className="dashboard-section-heading">
        <h2 id="services-heading">
          Services <span className="dashboard-count">{services.length}</span>
        </h2>
        <span className="project-quota">
          {services.length} of {limit} Services
        </span>
      </div>

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="dashboard-table-empty" role="status">
          Loading Services...
        </p>
      ) : services.length === 0 ? (
        <div className="dashboard-empty-state">
          <h3>No Services yet</h3>
          <p>
            {canManage
              ? "Create a Service from a public repository to build and run it on this platform."
              : "An owner or admin can create the first Service in this Project."}
          </p>
        </div>
      ) : (
        <ul className="service-list">
          {services.map((service) => (
            <li key={service.id} className="service-card">
              <div className="service-card-head">
                <div>
                  <h3>
                    <Link href={`/dashboard/services/${service.id}`}>{service.name}</Link>
                  </h3>
                  <a className="service-url" href={service.url} target="_blank" rel="noreferrer">
                    {service.platformHostname}
                  </a>
                </div>
                <span className="role-label">{serviceStatusLabel(service.status)}</span>
              </div>

              <dl className="service-meta">
                <div>
                  <dt>Repository</dt>
                  <dd>
                    {service.repoUrl} @ {service.branch}
                  </dd>
                </div>
                <div>
                  <dt>Container</dt>
                  <dd>
                    {service.dockerfilePath} · port {service.containerPort}
                    {service.healthPath ? ` · ${service.healthPath}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Limits</dt>
                  <dd>
                    {service.cpuLimit} vCPU · {service.memoryLimitMb} MB RAM
                  </dd>
                </div>
              </dl>

              {canManage ? (
                <div className="service-danger-row">
                  <label>
                    Type <strong>{service.name}</strong> to delete
                    <input
                      value={confirmations[service.id] ?? ""}
                      onChange={(event) =>
                        setConfirmations((current) => ({
                          ...current,
                          [service.id]: event.target.value,
                        }))
                      }
                      autoComplete="off"
                    />
                  </label>
                  <button
                    className="dashboard-danger-button"
                    type="button"
                    disabled={busy || (confirmations[service.id] ?? "") !== service.name}
                    onClick={() => void remove(service)}
                  >
                    Delete Service
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form className="service-form" onSubmit={submit}>
          <div className="dashboard-section-heading">
            <h3>Create a Service</h3>
          </div>
          <div className="service-form-grid">
            <label>
              Service name
              <input
                value={form.name}
                maxLength={80}
                required
                onChange={(event) => update("name", event.target.value)}
              />
            </label>
            <label>
              Repository URL
              <input
                value={form.repoUrl}
                type="url"
                placeholder="https://github.com/user/repo"
                required
                onChange={(event) => update("repoUrl", event.target.value)}
              />
            </label>
            <label>
              Branch
              <input
                value={form.branch}
                onChange={(event) => update("branch", event.target.value)}
              />
            </label>
            <label>
              Dockerfile path
              <input
                value={form.dockerfilePath}
                onChange={(event) => update("dockerfilePath", event.target.value)}
              />
            </label>
            <label>
              Container port
              <input
                value={form.containerPort}
                inputMode="numeric"
                onChange={(event) => update("containerPort", event.target.value)}
              />
            </label>
            <label>
              Health path
              <input
                value={form.healthPath}
                placeholder="/health"
                onChange={(event) => update("healthPath", event.target.value)}
              />
            </label>
          </div>
          <button
            className="create-project-button"
            type="submit"
            disabled={busy || atLimit || !form.name.trim() || !form.repoUrl.trim()}
          >
            {busy ? "Creating..." : "Create Service"}
          </button>
          {atLimit ? (
            <p className="project-quota-note">
              This Project has reached its Quota of {limit} Services. Delete a Service to create
              another one.
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
