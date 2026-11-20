"use client";

import { useCallback, useState } from "react";
import {
  Database,
  ShieldCheck,
  RefreshCw,
  Copy,
  Check,
  Eye,
  EyeOff,
  AlertTriangle,
  Loader2,
  Globe,
  Radio,
} from "lucide-react";
import {
  createProjectDatabase,
  databaseStatusLabel,
  deleteProjectDatabase,
  disableProjectDatabaseProxy,
  enableProjectDatabaseProxy,
  getProjectDatabase,
  rotateProjectDatabaseCredentials,
  type DatabaseSummary,
} from "@/lib/databases-client";
import { getError, useResource } from "@/lib/resource";
import { formatDateTime } from "@/lib/format";
import { useToast } from "@/components/toast-context";

function usageLabel(database: DatabaseSummary): string {
  if (database.usageMb === null) {
    return "0 MB of " + database.storageLimitMb + " MB";
  }

  return `${database.usageMb} MB of ${database.storageLimitMb} MB`;
}

export function DatabasePanel({
  projectId,
  projectName,
  canManage,
}: {
  projectId: string;
  projectName: string;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [allowlistDraft, setAllowlistDraft] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [revealPrivateUri, setRevealPrivateUri] = useState(false);
  const [revealPublicUri, setRevealPublicUri] = useState(false);
  const [copiedPrivate, setCopiedPrivate] = useState(false);
  const [copiedPublic, setCopiedPublic] = useState(false);

  const panel = useResource(
    useCallback(async () => {
      const result = await getProjectDatabase(projectId);
      return { database: result.database, needsRedeploy: result.needsRedeploy };
    }, [projectId]),
    [projectId],
  );
  const database: DatabaseSummary | null = panel.data?.database ?? null;
  const redeployNeeded = panel.data?.needsRedeploy ?? false;
  const loading = panel.loading;
  const allowlist =
    allowlistDraft ?? (database?.proxy.enabled ? database.proxy.allowlist.join("\n") : "");

  function copyText(text: string, type: "private" | "public") {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(() => {
        if (type === "private") {
          setCopiedPrivate(true);
          setTimeout(() => setCopiedPrivate(false), 2000);
        } else {
          setCopiedPublic(true);
          setTimeout(() => setCopiedPublic(false), 2000);
        }
        toast.success("Copied connection URI", "Ready to paste into your environment.");
      });
    }
  }

  async function create() {
    setBusy(true);
    setActionError("");
    try {
      await createProjectDatabase(projectId);
      await panel.refresh();
      toast.success("PostgreSQL Database created", "Private networking and storage attached.");
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    if (
      !window.confirm(
        "Rotate the Database password? Running Services keep the old URL until they are redeployed.",
      )
    ) {
      return;
    }

    setBusy(true);
    setActionError("");
    try {
      await rotateProjectDatabaseCredentials(projectId);
      await panel.refresh();
      toast.success("Credentials rotated", "Redeploy services to inject new DATABASE_URL.");
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setActionError("");
    try {
      await deleteProjectDatabase(projectId, confirmation);
      setConfirmation("");
      await panel.refresh();
      toast.success("Database deleted", "Database instance and disk volume removed.");
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  function parseAllowlist(value: string): string[] {
    return value
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  async function enableProxy() {
    setBusy(true);
    setActionError("");
    try {
      await enableProjectDatabaseProxy(projectId, parseAllowlist(allowlist));
      await panel.refresh();
      setAllowlistDraft(null);
      toast.success("Public proxy enabled", "Public port active with TLS enforcement.");
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function disableProxy() {
    if (!window.confirm("Disable the public proxy? The public port will be revoked immediately.")) {
      return;
    }

    setBusy(true);
    setActionError("");
    try {
      await disableProjectDatabaseProxy(projectId);
      await panel.refresh();
      toast.success("Public proxy disabled", "Public endpoint revoked.");
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="supabase-project-skeleton-card h-44" aria-hidden="true">
          <div className="supabase-skeleton-box h-5 w-48 rounded mb-4" />
          <div className="grid grid-cols-4 gap-4">
            <div className="supabase-skeleton-box h-12 rounded" />
            <div className="supabase-skeleton-box h-12 rounded" />
            <div className="supabase-skeleton-box h-12 rounded" />
            <div className="supabase-skeleton-box h-12 rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {redeployNeeded && (
        <div className="dashboard-alert is-warning" role="status">
          Database changes are saved but not live yet. Redeploy this project&apos;s Services to apply them.
        </div>
      )}

      {panel.error || actionError ? (
        <div className="dashboard-alert is-error" role="alert">
          {panel.error || actionError}
        </div>
      ) : null}

      {!database ? (
        /* Empty State */
        <div className="project-empty-card">
          <div className="project-empty-icon-wrap" aria-hidden="true">
            <Database className="w-8 h-8 text-emerald-400" />
          </div>
          <h3 className="text-base font-semibold text-white mt-3">No Database in this Project</h3>
          <p className="text-xs text-zinc-400 max-w-md mt-1 mb-4 text-center">
            Each project is entitled to one private PostgreSQL 16 database. Services inside the project automatically receive a secure <code>DATABASE_URL</code>.
          </p>
          {canManage && (
            <button
              type="button"
              className="supabase-btn-green"
              onClick={() => void create()}
              disabled={busy}
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                  Provisioning...
                </>
              ) : (
                <>
                  <Database className="w-4 h-4 mr-1.5" />
                  Provision PostgreSQL Database
                </>
              )}
            </button>
          )}
        </div>
      ) : (
        /* Database Overview */
        <>
          {/* Metrics Overview Card */}
          <div className="project-db-overview-card">
            <div className="project-db-overview-head">
              <div className="flex items-center gap-2.5">
                <div className="project-service-icon" aria-hidden="true">
                  <Database className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">PostgreSQL {database.version}</h3>
                  <p className="text-xs text-zinc-500 font-mono">
                    {database.username}@{database.databaseName}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <span
                  className={`project-service-status-pill ${
                    database.status === "running" ? "is-live" : "is-building"
                  }`}
                >
                  <span className="project-status-dot" aria-hidden="true" />
                  {databaseStatusLabel(database.status)}
                </span>
                <span
                  className={`project-health-badge ${
                    database.healthy ? "is-healthy" : "is-unhealthy"
                  }`}
                >
                  {database.healthy ? "Healthy" : "Unavailable"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-zinc-800/80">
              <div className="project-db-metric-box">
                <span className="project-db-metric-label">Disk Storage</span>
                <span className="project-db-metric-value">{usageLabel(database)}</span>
                <div className="supabase-usage-bar-track mt-1.5">
                  <div
                    className="supabase-usage-bar-fill"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(((database.usageMb ?? 0) / database.storageLimitMb) * 100),
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div className="project-db-metric-box">
                <span className="project-db-metric-label">Network Scope</span>
                <span className="project-db-metric-value flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Private Network</span>
                </span>
                <span className="text-[11px] text-zinc-500 mt-1">Host: db:5432</span>
              </div>

              <div className="project-db-metric-box">
                <span className="project-db-metric-label">Created At</span>
                <span className="project-db-metric-value text-xs text-zinc-300">
                  {formatDateTime(database.createdAt)}
                </span>
                <span className="text-[11px] text-zinc-500 mt-1">Daily backups active</span>
              </div>
            </div>
          </div>

          {/* Connection URI Card */}
          <div className="project-settings-card">
            <div className="project-settings-card-head">
              <div>
                <h3 className="project-settings-title">Private Connection String</h3>
                <p className="project-settings-desc">
                  Reachable directly from services in this project via <code>db:5432</code>. Injected automatically as <code>DATABASE_URL</code>.
                </p>
              </div>

              {canManage && (
                <button
                  type="button"
                  className="supabase-btn-secondary text-xs"
                  onClick={() => void rotate()}
                  disabled={busy}
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1 ${busy ? "animate-spin" : ""}`} />
                  <span>Rotate Password</span>
                </button>
              )}
            </div>

            <div className="p-5 space-y-4">
              {database.connectionString ? (
                <div className="project-code-box">
                  <div className="flex-1 font-mono text-xs text-zinc-300 overflow-x-auto select-all">
                    {revealPrivateUri
                      ? database.connectionString
                      : database.connectionString.replace(/:([^:@]+)@/, ":••••••••@")}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      className="project-code-btn"
                      onClick={() => setRevealPrivateUri((prev) => !prev)}
                      title={revealPrivateUri ? "Hide password" : "Show password"}
                      aria-label="Toggle password visibility"
                    >
                      {revealPrivateUri ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      className="project-code-btn"
                      onClick={() => copyText(database.connectionString ?? "", "private")}
                      title="Copy connection string"
                      aria-label="Copy connection string"
                    >
                      {copiedPrivate ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-zinc-500 text-xs">
                  Only an owner or admin can view the private connection string.
                </p>
              )}

              {/* Host and Credential breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                <div className="project-spec-pill">
                  <span className="project-spec-label">Host</span>
                  <span className="project-spec-val">db</span>
                </div>
                <div className="project-spec-pill">
                  <span className="project-spec-label">Port</span>
                  <span className="project-spec-val">5432</span>
                </div>
                <div className="project-spec-pill">
                  <span className="project-spec-label">Database</span>
                  <span className="project-spec-val">{database.databaseName}</span>
                </div>
                <div className="project-spec-pill">
                  <span className="project-spec-label">User</span>
                  <span className="project-spec-val">{database.username}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Public Proxy Card */}
          <div className="project-settings-card">
            <div className="project-settings-card-head">
              <div>
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-cyan-400" />
                  <h3 className="project-settings-title">Public Proxy (External Access)</h3>
                </div>
                <p className="project-settings-desc">
                  {database.proxy.enabled
                    ? `Proxy active on public port ${database.proxy.port}. Encrypted via TLS with strict CIDR allowlist enforcement.`
                    : "Disabled. This database cannot be reached from outside the private network."}
                </p>
              </div>

              <span
                className={`project-proxy-badge ${
                  database.proxy.enabled ? "is-enabled" : "is-disabled"
                }`}
              >
                <Radio className="w-3 h-3 mr-1" />
                {database.proxy.enabled ? "Active" : "Disabled"}
              </span>
            </div>

            <div className="p-5 space-y-4">
              {canManage ? (
                <>
                  <div>
                    <label htmlFor="proxy-cidrs-input" className="project-form-label">
                      Allowlisted CIDRs (one per line, e.g. <code>0.0.0.0/0</code> or <code>198.51.100.1/32</code>)
                    </label>
                    <textarea
                      id="proxy-cidrs-input"
                      value={allowlist}
                      onChange={(e) => setAllowlistDraft(e.target.value)}
                      placeholder="0.0.0.0/0"
                      rows={3}
                      spellCheck={false}
                      className="project-form-input font-mono text-xs"
                    />
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      className="supabase-btn-green"
                      onClick={() => void enableProxy()}
                      disabled={busy}
                    >
                      {database.proxy.enabled ? "Update Allowlist" : "Enable Public Proxy"}
                    </button>

                    {database.proxy.enabled && (
                      <button
                        type="button"
                        className="supabase-btn-secondary text-rose-400 hover:text-rose-300"
                        onClick={() => void disableProxy()}
                        disabled={busy}
                      >
                        Disable Proxy
                      </button>
                    )}
                  </div>

                  {database.proxy.enabled && database.proxy.connectionString && (
                    <div className="pt-2">
                      <span className="project-form-label block mb-1.5">Public Connection URI</span>
                      <div className="project-code-box">
                        <div className="flex-1 font-mono text-xs text-zinc-300 overflow-x-auto select-all">
                          {revealPublicUri
                            ? database.proxy.connectionString
                            : database.proxy.connectionString.replace(/:([^:@]+)@/, ":••••••••@")}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            type="button"
                            className="project-code-btn"
                            onClick={() => setRevealPublicUri((prev) => !prev)}
                            title={revealPublicUri ? "Hide password" : "Show password"}
                            aria-label="Toggle public password visibility"
                          >
                            {revealPublicUri ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            className="project-code-btn"
                            onClick={() => copyText(database.proxy.connectionString ?? "", "public")}
                            title="Copy public connection string"
                            aria-label="Copy public connection string"
                          >
                            {copiedPublic ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-zinc-500 text-xs">
                  Only an owner or admin can manage the public proxy or view its connection credentials.
                </p>
              )}
            </div>
          </div>

          {/* Delete Database Danger Zone */}
          {canManage && (
            <div className="project-danger-card">
              <div className="project-danger-card-head">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  <h3 className="project-danger-title">Delete Database</h3>
                </div>
                <p className="project-danger-desc">
                  Permanently deletes the PostgreSQL container, volume storage, and all relational data. This action is irreversible.
                </p>
              </div>

              <form onSubmit={remove} className="project-danger-body">
                <div className="max-w-md">
                  <label htmlFor="delete-db-confirm-input" className="project-form-label">
                    Type <strong>{projectName}</strong> to confirm deletion:
                  </label>
                  <input
                    id="delete-db-confirm-input"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    placeholder={projectName}
                    autoComplete="off"
                    required
                    className="project-form-input border-rose-900/50 focus:border-rose-500"
                  />
                </div>

                <div className="project-danger-card-footer">
                  <button
                    type="submit"
                    className="project-btn-danger"
                    disabled={busy || confirmation !== projectName}
                  >
                    {busy ? "Deleting..." : "Delete Database"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  );
}
