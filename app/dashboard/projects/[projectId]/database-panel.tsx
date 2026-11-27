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
  databaseEngineLabel,
  databaseStatusLabel,
  deleteProjectDatabase,
  disableProjectDatabaseProxy,
  enableProjectDatabaseProxy,
  getProjectDatabase,
  revealProjectDatabasePassword,
  rotateProjectDatabaseCredentials,
  startPhpMyAdminSession,
  type DatabaseEngine,
  type DatabaseSummary,
} from "@/lib/databases-client";
import { getError, useResource } from "@/lib/resource";
import { formatDateTime } from "@/lib/format";
import { useToast } from "@/components/toast-context";
import { CredentialRow, PasswordRow } from "./database-credentials";

function usageLabel(database: DatabaseSummary): string {
  if (database.usageMb === null) {
    return "0 MB of " + database.storageLimitMb + " MB";
  }

  return `${database.usageMb} MB of ${database.storageLimitMb} MB`;
}

/**
 * The two engines the platform offers. MySQL cannot be reached through the TCP
 * proxy PostgreSQL uses, so it always comes with phpMyAdmin; the card below
 * says so before the user commits, because the engine cannot be changed later.
 */
const ENGINE_CHOICES: Array<{
  id: DatabaseEngine;
  name: string;
  version: string;
  note: string;
  client: string;
}> = [
  {
    id: "postgres",
    name: "PostgreSQL",
    version: "16",
    note: "The default. Full SQL feature set and a public TLS proxy for external clients.",
    client: "Public proxy",
  },
  {
    id: "mysql",
    name: "MySQL",
    version: "8",
    note: "The engine most PHP apps expect.",
    client: "phpMyAdmin included",
  },
];

export function DatabasePanel({
  projectId,
  projectName,
  canManage,
  onChanged,
}: {
  projectId: string;
  projectName: string;
  canManage: boolean;
  /**
   * Tells the Project header to re-read the summary. The header names the
   * Database engine, and only this panel knows when that changes.
   */
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<DatabaseEngine>("postgres");
  const [confirmation, setConfirmation] = useState("");
  const [allowlistDraft, setAllowlistDraft] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [revealPrivateUri, setRevealPrivateUri] = useState(false);
  const [revealPublicUri, setRevealPublicUri] = useState(false);
  const [copiedPrivate, setCopiedPrivate] = useState(false);
  const [copiedPublic, setCopiedPublic] = useState(false);
  /** Which credential row last copied, so its icon can show a tick. */
  const [copiedCredential, setCopiedCredential] = useState<string | null>(null);
  const [pmaSigningIn, setPmaSigningIn] = useState(false);
  const [credentialError, setCredentialError] = useState("");

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
  /** The internal address a Service in this Project dials, with its port. */
  const databaseHost = `db:${database?.engine === "mysql" ? "3306" : "5432"}`;

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

  /**
   * Copies one credential and ticks its row for 1.5 seconds. The value is the
   * full one, even when the row shows a shortened form.
   */
  function copyCredential(label: string, value: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    void navigator.clipboard.writeText(value).then(() => {
      setCopiedCredential(label);
      setTimeout(() => {
        setCopiedCredential((current) => (current === label ? null : current));
      }, 1500);
    });
  }

  /**
   * Opens phpMyAdmin already signed in. The API mints a one-time link on the
   * phpMyAdmin host, which logs in server-side and returns the session cookie.
   *
   * The tab is opened synchronously, because a `window.open` that follows an
   * `await` is no longer tied to the click and mobile browsers block it. It is
   * opened with `about:blank`, then navigated by the opener once the link arrives:
   * with `noopener` the opener keeps no handle on the new window, so the URL is
   * set from a script in this page instead of by `tab.location`.
   */
  async function openPhpMyAdmin() {
    setPmaSigningIn(true);
    setCredentialError("");

    const tab = window.open("about:blank", "_blank");
    try {
      const session = await startPhpMyAdminSession(projectId);
      if (tab && !tab.closed) {
        // `noopener` is not used above for exactly this reason: a handle is
        // needed to send the new tab to the signed-in URL. The URL is
        // same-origin-safe (the platform's own phpMyAdmin host) and carries a
        // one-time token, and the opener relationship is then severed.
        tab.opener = null;
        tab.location.replace(session.url);
      } else {
        // The popup was blocked; navigating the current tab still signs in, and
        // the browser's Back button returns to the dashboard.
        window.location.assign(session.url);
      }
    } catch (cause) {
      tab?.close();
      setCredentialError(getError(cause));
    } finally {
      setPmaSigningIn(false);
    }
  }

  async function create() {
    setBusy(true);
    setActionError("");
    try {
      const created = await createProjectDatabase(projectId, { engine });
      await panel.refresh();
      onChanged?.();
      toast.success(
        `${created.engine === "mysql" ? "MySQL" : "PostgreSQL"} Database created`,
        created.phpMyAdmin.enabled
          ? "Private networking, storage, and phpMyAdmin attached."
          : "Private networking and storage attached.",
      );
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
      onChanged?.();
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
        <div className="supabase-project-skeleton-card flex flex-col justify-between p-[16px] rounded-card border border-surface-raised min-h-[120px] h-44" aria-hidden="true">
          <div className="supabase-skeleton-box animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-5 w-48 rounded mb-4" />
          <div className="grid grid-cols-4 gap-4">
            <div className="supabase-skeleton-box animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-12 rounded" />
            <div className="supabase-skeleton-box animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-12 rounded" />
            <div className="supabase-skeleton-box animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-12 rounded" />
            <div className="supabase-skeleton-box animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-12 rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {redeployNeeded && (
        <div className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-warning" role="status">
          Database changes are saved but not live yet. Redeploy this project&apos;s Services to
          apply them.
        </div>
      )}

      {panel.error || actionError ? (
        <div className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error" role="alert">
          {panel.error || actionError}
        </div>
      ) : null}

      {!database ? (
        /* Empty State */
        <div className="project-empty-card flex flex-col items-center justify-center py-[56px] px-[24px] rounded-card border border-dashed border-[#262430] text-center">
          <div className="project-empty-icon-wrap flex items-center justify-center w-[48px] h-[48px] rounded-card-lg" aria-hidden="true">
            <Database className="w-8 h-8 text-emerald-400" />
          </div>
          <h3 className="text-base font-semibold text-white mt-3">No Database in this Project</h3>
          <p className="text-xs text-zinc-400 max-w-md mt-1">
            Each project is entitled to one private database. Services inside the project
            automatically receive a secure <code>DATABASE_URL</code>.
          </p>

          {canManage && (
            <>
              <p className="text-[11px] uppercase tracking-wide text-zinc-500 mt-4 mb-2">
                Choose an engine
              </p>
              <div className="db-engine-choice grid gap-[10px] w-full max-w-[520px] mt-[4px] text-left" role="radiogroup" aria-label="Database engine">
                {ENGINE_CHOICES.map((choice) => {
                  const selected = engine === choice.id;
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`db-engine-option${selected ? " is-selected" : ""}`}
                      onClick={() => setEngine(choice.id)}
                      disabled={busy}
                    >
                      <span className="text-[13.5px] font-semibold text-ink-bright">
                        {choice.name} {choice.version}
                      </span>
                      <span className="text-[11.5px] leading-[1.45] text-[#8b8b96]">{choice.note}</span>
                      <span className="self-start mt-[2px] py-[2px] px-[6px] rounded-control-sm bg-[#211f29] text-[10.5px] font-medium text-[#b4b3bd]">{choice.client}</span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                className="supabase-btn-green mt-4"
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
                    {engine === "mysql"
                      ? "Provision MySQL Database"
                      : "Provision PostgreSQL Database"}
                  </>
                )}
              </button>
            </>
          )}
        </div>
      ) : (
        /* Database Overview */
        <>
          {/* Metrics Overview Card */}
          <div className="p-[20px] rounded-card bg-surface border border-[var(--color-surface-raised)]">
            <div className="flex items-center justify-between flex-wrap gap-[12px] mb-[16px]">
              <div className="flex items-center gap-2.5">
                <div className="project-service-icon flex items-center justify-center w-[32px] h-[32px] rounded-control shrink-0" aria-hidden="true">
                  <Database className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    {databaseEngineLabel(database.engine, database.version)}
                  </h3>
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
                  <span className="project-status-dot w-[6px] h-[6px] rounded-[50%]" aria-hidden="true" />
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
              <div className="flex flex-col">
                <span className="text-[11.5px] text-[#716f7c] mb-[3px]">Disk Storage</span>
                <span className="text-[13px] font-semibold text-ink">{usageLabel(database)}</span>
                <div className="supabase-usage-bar-track w-full h-[4px] rounded-[99px] overflow-hidden mt-1.5">
                  <div
                    className="supabase-usage-bar-fill h-full rounded-[99px] [transition:width_300ms_ease]"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(((database.usageMb ?? 0) / database.storageLimitMb) * 100),
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-col">
                <span className="text-[11.5px] text-[#716f7c] mb-[3px]">Network Scope</span>
                <span className="text-[13px] font-semibold text-ink flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Private Network</span>
                </span>
                <span className="text-[11px] text-zinc-500 mt-1">
                  Host: db:{database.engine === "mysql" ? "3306" : "5432"}
                </span>
              </div>

              <div className="flex flex-col">
                <span className="text-[11.5px] text-[#716f7c] mb-[3px]">Created At</span>
                <span className="text-[13px] font-semibold text-ink text-xs text-zinc-300">
                  {formatDateTime(database.createdAt)}
                </span>
                <span className="text-[11px] text-zinc-500 mt-1">Daily backups active</span>
              </div>
            </div>
          </div>

          {/* Connection URI Card */}
          <div className="project-settings-card rounded-card border border-surface-raised overflow-hidden">
            <div className="flex items-center justify-between py-[16px] px-[20px] border-b border-b-[#23212a]">
              <div>
                <h3 className="text-[14.5px] font-semibold text-ink m-0">Private Connection String</h3>
                <p className="text-[12px] text-[#716f7c] mt-[3px] mb-0 mx-0">
                  Reachable directly from services in this project via{" "}
                  <code>db:{database.engine === "mysql" ? "3306" : "5432"}</code>. Injected
                  automatically as <code>DATABASE_URL</code>.
                </p>
              </div>

              {canManage && (
                <button
                  type="button"
                  className="supabase-btn-secondary inline-flex items-center justify-center min-h-[38px] rounded-card border border-[#2a2834] bg-[#181720] [box-shadow:0_1px_2px_rgba(0,0,0,0.2)] whitespace-nowrap no-underline [transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease,color_120ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:border-[#3b3749] [&:hover:not(:disabled)]:bg-[#201e2a] [&:active:not(:disabled)]:translate-y-[1px] disabled:opacity-[0.5] disabled:transform-none text-xs"
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
                <div className="project-code-box flex items-center justify-between gap-[10px] py-[10px] px-[14px] rounded-control border border-[#232129]">
                  <div className="flex-1 font-mono text-xs text-zinc-300 overflow-x-auto select-all">
                    {revealPrivateUri
                      ? database.connectionString
                      : database.connectionString.replace(/:([^:@]+)@/, ":••••••••@")}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      className="project-code-btn inline-flex items-center justify-center w-[28px] h-[28px] rounded-control-sm border border-[#2e2c39] text-[#8e8c99] cursor-pointer [transition:all_120ms] hover:text-ink"
                      onClick={() => setRevealPrivateUri((prev) => !prev)}
                      title={revealPrivateUri ? "Hide password" : "Show password"}
                      aria-label="Toggle password visibility"
                    >
                      {revealPrivateUri ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="project-code-btn inline-flex items-center justify-center w-[28px] h-[28px] rounded-control-sm border border-[#2e2c39] text-[#8e8c99] cursor-pointer [transition:all_120ms] hover:text-ink"
                      onClick={() => copyText(database.connectionString ?? "", "private")}
                      title="Copy connection string"
                      aria-label="Copy connection string"
                    >
                      {copiedPrivate ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-zinc-500 text-xs">
                  Only an owner or admin can view the private connection string.
                </p>
              )}

              {database.engine === "postgres" ? (
                <div className="db-cred-card flex flex-col rounded-card border border-[#232129] overflow-hidden">
                  <CredentialRow
                    label="Host"
                    value={databaseHost}
                    onCopy={copyCredential}
                    copied={copiedCredential === "Host"}
                  />
                  <CredentialRow
                    label="Database"
                    value={database.databaseName}
                    onCopy={copyCredential}
                    copied={copiedCredential === "Database"}
                  />
                  <CredentialRow
                    label="User"
                    value={database.username}
                    onCopy={copyCredential}
                    copied={copiedCredential === "User"}
                  />
                  {canManage ? (
                    <PasswordRow
                      fetchPassword={() =>
                        revealProjectDatabasePassword(projectId).then((r) => r.password)
                      }
                      onCopied={(value) => copyCredential("Password", value)}
                      onError={setCredentialError}
                      copied={copiedCredential === "Password"}
                    />
                  ) : (
                    <div className="db-cred-row">
                      <span className="flex items-center gap-[8px] text-[10.5px] uppercase tracking-[0.04em] text-[#636170]">Password</span>
                      <div className="flex items-start gap-[10px] min-w-0">
                        <span className="db-cred-value min-w-0 text-[14px] leading-[1.5] [overflow-wrap:anywhere] db-cred-muted [font-family:inherit]">Owner or admin only</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {credentialError && database.engine === "postgres" ? (
                <p className="text-[11.5px] text-[#ff7a82] mt-[6px]" role="alert">
                  <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
                  {credentialError}
                </p>
              ) : null}
            </div>
          </div>

          {/* phpMyAdmin Card (MySQL only) */}
          {database.phpMyAdmin.enabled ? (
            <div className="project-settings-card rounded-card border border-surface-raised overflow-hidden">
              <div className="flex items-center justify-between py-[16px] px-[20px] border-b border-b-[#23212a]">
                <div>
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-[14.5px] font-semibold text-ink m-0">phpMyAdmin</h3>
                  </div>
                  <p className="text-[12px] text-[#716f7c] mt-[3px] mb-0 mx-0">
                    A browser client for this Database, served on the Platform Domain over HTTPS.
                    It reaches MySQL through the private Project network.
                  </p>
                </div>
                <span
                  className={`project-proxy-badge ${
                    database.phpMyAdmin.ready ? "is-enabled" : "is-disabled"
                  }`}
                >
                  <Radio className="w-3 h-3 mr-1" />
                  {database.phpMyAdmin.ready ? "Ready" : "Starting"}
                </span>
              </div>

              <div className="p-5 space-y-4">
                {database.phpMyAdmin.url ? (
                  <>
                    <button
                      type="button"
                      className="supabase-btn-green"
                      onClick={() => void openPhpMyAdmin()}
                      disabled={pmaSigningIn}
                    >
                      {pmaSigningIn ? (
                        <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                      ) : (
                        <Globe className="w-4 h-4 mr-1.5" />
                      )}
                      {pmaSigningIn ? "Signing in…" : "Open phpMyAdmin"}
                    </button>

                    {credentialError ? (
                      <p className="text-[11.5px] text-[#ff7a82] mt-[6px]" role="alert">
                        <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
                        {credentialError}
                      </p>
                    ) : null}

                    <div className="db-cred-card flex flex-col rounded-card border border-[#232129] overflow-hidden">
                      <CredentialRow
                        label="Host"
                        value={databaseHost}
                        onCopy={copyCredential}
                        copied={copiedCredential === "Host"}
                      />
                      <CredentialRow
                        label="Database"
                        value={database.databaseName}
                        onCopy={copyCredential}
                        copied={copiedCredential === "Database"}
                      />
                      <CredentialRow
                        label="User"
                        value={database.username}
                        onCopy={copyCredential}
                        copied={copiedCredential === "User"}
                      />
                      {canManage ? (
                        <PasswordRow
                          fetchPassword={() =>
                            revealProjectDatabasePassword(projectId).then((r) => r.password)
                          }
                          onCopied={(value) => copyCredential("Password", value)}
                          onError={setCredentialError}
                          copied={copiedCredential === "Password"}
                        />
                      ) : (
                        <div className="db-cred-row">
                          <span className="flex items-center gap-[8px] text-[10.5px] uppercase tracking-[0.04em] text-[#636170]">Password</span>
                          <div className="flex items-start gap-[10px] min-w-0">
                            <span className="db-cred-value min-w-0 text-[14px] leading-[1.5] [overflow-wrap:anywhere] db-cred-muted [font-family:inherit]">
                              Owner or admin only
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    <p className="text-[11px] text-zinc-500">
                      Sign in here only with the credentials above; this page is shared by every MySQL
                      Database on the platform.
                    </p>
                  </>
                ) : (
                  <p className="text-zinc-500 text-xs">
                    The phpMyAdmin address is not allocated yet. Redeploy the Database to finish
                    provisioning.
                  </p>
                )}
              </div>
            </div>
          ) : null}

          {/* Public Proxy Card (PostgreSQL only) */}
          {database.engine === "postgres" ? (
            <div className="project-settings-card rounded-card border border-surface-raised overflow-hidden">
              <div className="flex items-center justify-between py-[16px] px-[20px] border-b border-b-[#23212a]">
                <div>
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-[14.5px] font-semibold text-ink m-0">Public Proxy (External Access)</h3>
                  </div>
                  <p className="text-[12px] text-[#716f7c] mt-[3px] mb-0 mx-0">
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
                        Allowlisted CIDRs (one per line, e.g. <code>0.0.0.0/0</code> or{" "}
                        <code>198.51.100.1/32</code>)
                      </label>
                      <textarea
                        id="proxy-cidrs-input"
                        value={allowlist}
                        onChange={(e) => setAllowlistDraft(e.target.value)}
                        placeholder="0.0.0.0/0"
                        rows={3}
                        spellCheck={false}
                        className="project-form-input w-full h-[38px] py-0 px-[12px] rounded-control text-ink text-[13px]! outline-none [transition:border-color_150ms] font-mono text-xs"
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
                          className="supabase-btn-secondary inline-flex items-center justify-center min-h-[38px] rounded-card border border-[#2a2834] bg-[#181720] [box-shadow:0_1px_2px_rgba(0,0,0,0.2)] whitespace-nowrap no-underline [transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease,color_120ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:border-[#3b3749] [&:hover:not(:disabled)]:bg-[#201e2a] [&:active:not(:disabled)]:translate-y-[1px] disabled:opacity-[0.5] disabled:transform-none text-rose-400 hover:text-rose-300"
                          onClick={() => void disableProxy()}
                          disabled={busy}
                        >
                          Disable Proxy
                        </button>
                      )}
                    </div>

                    {database.proxy.enabled && database.proxy.connectionString && (
                      <div className="pt-2">
                        <span className="project-form-label block mb-1.5">
                          Public Connection URI
                        </span>
                        <div className="project-code-box flex items-center justify-between gap-[10px] py-[10px] px-[14px] rounded-control border border-[#232129]">
                          <div className="flex-1 font-mono text-xs text-zinc-300 overflow-x-auto select-all">
                            {revealPublicUri
                              ? database.proxy.connectionString
                              : database.proxy.connectionString.replace(/:([^:@]+)@/, ":••••••••@")}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              type="button"
                              className="project-code-btn inline-flex items-center justify-center w-[28px] h-[28px] rounded-control-sm border border-[#2e2c39] text-[#8e8c99] cursor-pointer [transition:all_120ms] hover:text-ink"
                              onClick={() => setRevealPublicUri((prev) => !prev)}
                              title={revealPublicUri ? "Hide password" : "Show password"}
                              aria-label="Toggle public password visibility"
                            >
                              {revealPublicUri ? (
                                <EyeOff className="w-3.5 h-3.5" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              className="project-code-btn inline-flex items-center justify-center w-[28px] h-[28px] rounded-control-sm border border-[#2e2c39] text-[#8e8c99] cursor-pointer [transition:all_120ms] hover:text-ink"
                              onClick={() =>
                                copyText(database.proxy.connectionString ?? "", "public")
                              }
                              title="Copy public connection string"
                              aria-label="Copy public connection string"
                            >
                              {copiedPublic ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-zinc-500 text-xs">
                    Only an owner or admin can manage the public proxy or view its connection
                    credentials.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="project-settings-card rounded-card border border-surface-raised overflow-hidden">
              <div className="flex items-center justify-between py-[16px] px-[20px] border-b border-b-[#23212a]">
                <div>
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-[14.5px] font-semibold text-ink m-0">External Access</h3>
                  </div>
                  <p className="text-[12px] text-[#716f7c] mt-[3px] mb-0 mx-0">
                    A MySQL Database is reached through phpMyAdmin above. The TCP public proxy is
                    PostgreSQL-only because it forwards a TLS stream MySQL does not speak.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Delete Database Danger Zone */}
          {canManage && (
            <div className="project-danger-card rounded-card border border-[rgba(244,63,94,0.25)] overflow-hidden">
              <div className="project-danger-card-head py-[16px] px-[20px] border-b border-b-[rgba(244,63,94,0.15)]">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  <h3 className="text-[14.5px] font-semibold text-[var(--color-danger)] m-0">Delete Database</h3>
                </div>
                <p className="text-[12px] text-[#9e9aa8] mt-[4px] mb-0 mx-0">
                  Permanently deletes the {database.engine === "mysql" ? "MySQL" : "PostgreSQL"}{" "}
                  container, its phpMyAdmin sidecar if any, volume storage, and all relational data.
                  This action is irreversible.
                </p>
              </div>

              <form onSubmit={remove} className="p-[20px]">
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
                    className="project-form-input w-full h-[38px] py-0 px-[12px] rounded-control text-ink text-[13px]! outline-none [transition:border-color_150ms] border-rose-900/50 focus:border-rose-500"
                  />
                </div>

                <div className="project-danger-card-footer flex items-center justify-end py-[14px] px-[20px] border-t border-t-[rgba(244,63,94,0.15)] mt-[20px]">
                  <button
                    type="submit"
                    className="project-btn-danger inline-flex items-center justify-center gap-[8px] min-h-[38px] py-[8px] px-[16px] rounded-card border-0 bg-[#e11d48] [background-image:linear-gradient(180deg,var(--color-danger)_0%,#e11d48_100%)] [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.25),0_1px_3px_rgba(0,0,0,0.3),0_0_0_1px_#be123c] text-ink text-[13.5px]! font-medium! whitespace-nowrap [transition:background-color_150ms_ease,box-shadow_150ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:[background-image:linear-gradient(180deg,#fb7185_0%,var(--color-danger)_100%)] [&:hover:not(:disabled)]:text-ink [&:active:not(:disabled)]:translate-y-[1] disabled:transform-none disabled:[box-shadow:none]"
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
