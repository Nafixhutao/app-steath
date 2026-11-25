"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Container,
  Plus,
  ExternalLink,
  GitBranch,
  Server,
  Cpu,
  Trash2,
  X,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import {
  createService,
  deleteService,
  listServices,
  serviceStatusLabel,
  type ServiceSummary,
} from "@/lib/services-client";
import { QUOTAS } from "@/lib/platform/quota-limits";
import { getError, useResource } from "@/lib/resource";
import { useToast } from "@/components/toast-context";

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
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ServiceSummary | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const limit = QUOTAS.servicesPerProject;

  const panel = useResource(() => listServices(projectId), [projectId]);
  const services: ServiceSummary[] = panel.data ?? [];
  const loading = panel.loading;
  const atLimit = services.length >= limit;

  function update<K extends keyof typeof EMPTY_FORM>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setActionError("");
    try {
      const createdName = form.name.trim();
      await createService(projectId, {
        name: createdName,
        repoUrl: form.repoUrl.trim(),
        branch: form.branch.trim() || undefined,
        dockerfilePath: form.dockerfilePath.trim() || undefined,
        containerPort: form.containerPort.trim() ? Number(form.containerPort) : undefined,
        healthPath: form.healthPath.trim() || undefined,
      });
      setForm(EMPTY_FORM);
      setModalOpen(false);
      toast.success("Service created", `"${createdName}" is deploying.`);
      await panel.refresh();
      onChanged?.();
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteTarget) return;

    setBusy(true);
    setActionError("");
    try {
      await deleteService(deleteTarget.id, deleteConfirm);
      toast.success("Service deleted", `"${deleteTarget.name}" has been removed.`);
      setDeleteTarget(null);
      setDeleteConfirm("");
      await panel.refresh();
      onChanged?.();
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Action Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Services</h2>
          <p className="text-xs text-zinc-400">
            {services.length} of {limit} Services in this project
          </p>
        </div>

        {canManage && (
          <button
            type="button"
            className="supabase-btn-green"
            onClick={() => {
              setActionError("");
              setModalOpen(true);
            }}
            disabled={atLimit || busy}
            title={atLimit ? `Limit of ${limit} services reached` : undefined}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>New Service</span>
          </button>
        )}
      </div>

      {panel.error || actionError ? (
        <div className="dashboard-alert is-error" role="alert">
          {panel.error || actionError}
        </div>
      ) : null}

      {/* Services List / Empty State */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3">
          {[1, 2].map((n) => (
            <div key={n} className="supabase-project-skeleton-card h-28" aria-hidden="true">
              <div className="supabase-skeleton-box h-4 w-36 rounded mb-2" />
              <div className="supabase-skeleton-box h-3 w-48 rounded mb-4" />
              <div className="supabase-skeleton-box h-3 w-24 rounded" />
            </div>
          ))}
        </div>
      ) : services.length === 0 ? (
        <div className="project-empty-card">
          <div className="project-empty-icon-wrap" aria-hidden="true">
            <Container className="w-8 h-8 text-zinc-500" />
          </div>
          <h3 className="text-base font-semibold text-white mt-3">No services deployed yet</h3>
          <p className="text-xs text-zinc-400 max-w-md mt-1 mb-4 text-center">
            Deploy fullstack Next.js apps, Node.js APIs, or custom Docker containers from any public
            Git repository.
          </p>
          {canManage && (
            <button
              type="button"
              className="supabase-btn-green"
              onClick={() => setModalOpen(true)}
              disabled={atLimit}
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Deploy First Service</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {services.map((service) => {
            const isLive = service.status === "running";
            return (
              <div key={service.id} className="project-service-item">
                <div className="project-service-head">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="project-service-icon" aria-hidden="true">
                      <Container className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <Link
                        href={`/dashboard/services/${service.id}`}
                        className="project-service-name"
                      >
                        {service.name}
                      </Link>
                      <a
                        href={service.url}
                        target="_blank"
                        rel="noreferrer"
                        className="project-service-hostname"
                      >
                        <span>{service.platformHostname}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={`project-service-status-pill ${
                        isLive ? "is-live" : "is-building"
                      }`}
                    >
                      <span className="project-status-dot" aria-hidden="true" />
                      {serviceStatusLabel(service.status)}
                    </span>

                    {canManage && (
                      <button
                        type="button"
                        className="project-service-delete-btn"
                        onClick={() => {
                          setDeleteTarget(service);
                          setDeleteConfirm("");
                        }}
                        title={`Delete ${service.name}`}
                        aria-label={`Delete ${service.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="project-service-footer">
                  <span className="project-service-spec">
                    <GitBranch className="w-3.5 h-3.5 text-zinc-500" />
                    <span>{service.branch}</span>
                  </span>
                  <span className="project-service-spec">
                    <Server className="w-3.5 h-3.5 text-zinc-500" />
                    <span>port {service.containerPort}</span>
                  </span>
                  <span className="project-service-spec">
                    <Cpu className="w-3.5 h-3.5 text-zinc-500" />
                    <span>
                      {service.cpuLimit} vCPU · {service.memoryLimitMb} MB
                    </span>
                  </span>

                  <Link
                    href={`/dashboard/services/${service.id}`}
                    className="project-service-view-link ml-auto"
                  >
                    Manage Service &rarr;
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Create Service */}
      {modalOpen && (
        <div className="supabase-modal-backdrop" role="presentation">
          <div
            className="supabase-modal-dialog max-w-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-service-title"
          >
            <div className="supabase-modal-header">
              <h2 id="create-service-title">Create a new service</h2>
              <button
                type="button"
                className="supabase-modal-close"
                onClick={() => setModalOpen(false)}
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={submit}>
              <div className="supabase-modal-body space-y-3.5">
                <p className="text-sm text-zinc-400 mb-4">
                  Each service builds from a public Git repository and runs as an isolated Docker
                  container with its own subdomain.
                </p>
                <div>
                  <label htmlFor="service-name-input" className="supabase-modal-label">
                    Service Name
                  </label>
                  <input
                    id="service-name-input"
                    value={form.name}
                    maxLength={80}
                    required
                    placeholder="e.g. web-frontend"
                    onChange={(e) => update("name", e.target.value)}
                    className="supabase-modal-input"
                    autoFocus
                  />
                </div>

                <div>
                  <label htmlFor="repo-url-input" className="supabase-modal-label">
                    Git Repository URL (public HTTPS)
                  </label>
                  <input
                    id="repo-url-input"
                    value={form.repoUrl}
                    type="url"
                    required
                    placeholder="https://github.com/org/repo"
                    onChange={(e) => update("repoUrl", e.target.value)}
                    className="supabase-modal-input"
                  />
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
                    No Dockerfile needed: static sites and Node.js/Next.js projects are detected
                    automatically. Pasting a folder URL (…/tree/main/app) builds just that folder.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="branch-input" className="supabase-modal-label">
                      Git Branch
                    </label>
                    <input
                      id="branch-input"
                      value={form.branch}
                      placeholder="main"
                      onChange={(e) => update("branch", e.target.value)}
                      className="supabase-modal-input"
                    />
                  </div>
                  <div>
                    <label htmlFor="port-input" className="supabase-modal-label">
                      Container Port
                    </label>
                    <input
                      id="port-input"
                      value={form.containerPort}
                      inputMode="numeric"
                      placeholder="3000"
                      onChange={(e) => update("containerPort", e.target.value)}
                      className="supabase-modal-input"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="dockerfile-input" className="supabase-modal-label">
                      Dockerfile Path (Optional)
                    </label>
                    <input
                      id="dockerfile-input"
                      value={form.dockerfilePath}
                      placeholder="Dockerfile"
                      onChange={(e) => update("dockerfilePath", e.target.value)}
                      className="supabase-modal-input font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="health-input" className="supabase-modal-label">
                      Health Check Path (Optional)
                    </label>
                    <input
                      id="health-input"
                      value={form.healthPath}
                      placeholder="/health"
                      onChange={(e) => update("healthPath", e.target.value)}
                      className="supabase-modal-input font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="supabase-modal-footer">
                <button
                  type="button"
                  className="supabase-btn-secondary"
                  onClick={() => setModalOpen(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="supabase-btn-green"
                  disabled={busy || !form.name.trim() || !form.repoUrl.trim()}
                >
                  {busy ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                      Creating...
                    </>
                  ) : (
                    "Create service"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Service Confirmation */}
      {deleteTarget && (
        <div className="supabase-modal-backdrop" role="presentation">
          <div
            className="supabase-modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-service-dialog-title"
          >
            <div className="supabase-modal-header border-rose-900/40">
              <div className="flex items-center gap-2 text-rose-400">
                <AlertTriangle className="w-4 h-4" />
                <h2 id="delete-service-dialog-title">Delete Service</h2>
              </div>
              <button
                type="button"
                className="supabase-modal-close"
                onClick={() => setDeleteTarget(null)}
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleDelete}>
              <div className="supabase-modal-body space-y-3">
                <p className="text-xs text-zinc-300">
                  This action will permanently stop container execution and delete all deployments
                  for <strong className="text-white">{deleteTarget.name}</strong>.
                </p>
                <div>
                  <label htmlFor="delete-service-confirm-input" className="supabase-modal-label">
                    Type <strong>{deleteTarget.name}</strong> to confirm:
                  </label>
                  <input
                    id="delete-service-confirm-input"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder={deleteTarget.name}
                    className="supabase-modal-input border-rose-900/50 focus:border-rose-500"
                    autoFocus
                  />
                </div>
              </div>

              <div className="supabase-modal-footer">
                <button
                  type="button"
                  className="supabase-btn-secondary"
                  onClick={() => setDeleteTarget(null)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="project-btn-danger"
                  disabled={busy || deleteConfirm !== deleteTarget.name}
                >
                  {busy ? "Deleting..." : "Delete Service"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
