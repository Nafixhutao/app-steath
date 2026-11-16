"use client";

import { useCallback, useState } from "react";
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

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function usageLabel(database: DatabaseSummary): string {
  if (database.usageMb === null) {
    return "Unavailable: the node did not answer";
  }

  return `${database.usageMb} MB of ${database.storageLimitMb} MB`;
}

/**
 * The Project's one private PostgreSQL Database. Every role can see its health
 * and storage; only owners and admins receive the connection string and can
 * rotate credentials or delete it. A credential change is not live until the
 * Project's Services are redeployed, so the panel repeats the redeploy banner.
 */
export function DatabasePanel({
  projectId,
  projectName,
  canManage,
}: {
  projectId: string;
  projectName: string;
  canManage: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  // Null means the draft follows the server value; typing detaches it until a
  // proxy change reloads the panel.
  const [allowlistDraft, setAllowlistDraft] = useState<string | null>(null);
  // Every action failure shares one slot next to the load error.
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

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

  async function create() {
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      await createProjectDatabase(projectId);
      await panel.refresh();
      setNotice("Database created.");
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
    setNotice("");
    try {
      await rotateProjectDatabaseCredentials(projectId);
      await panel.refresh();
      setNotice("Credentials rotated. Redeploy the Services to apply the new DATABASE_URL.");
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      await deleteProjectDatabase(projectId, confirmation);
      setConfirmation("");
      await panel.refresh();
      setNotice("Database deleted.");
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
    setNotice("");
    try {
      await enableProjectDatabaseProxy(projectId, parseAllowlist(allowlist));
      await panel.refresh();
      setAllowlistDraft(null);
      setNotice("Public proxy enabled. Only the listed CIDRs can connect over TLS.");
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
    setNotice("");
    try {
      await disableProjectDatabaseProxy(projectId);
      await panel.refresh();
      setNotice("Public proxy disabled and its endpoint revoked.");
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dashboard-section" aria-labelledby="database-heading">
      <div className="dashboard-section-heading">
        <h2 id="database-heading">Database</h2>
        {canManage && !database ? (
          <button
            className="create-project-button"
            type="button"
            onClick={() => void create()}
            disabled={busy}
          >
            {busy ? "Creating..." : "Create Database"}
          </button>
        ) : null}
      </div>

      {redeployNeeded ? (
        <p className="environment-redeploy-banner" role="status">
          Database changes are saved but not live yet. Redeploy this Project&apos;s Services to
          apply them.
        </p>
      ) : null}

      {panel.error || actionError ? (
        <p className="dashboard-alert is-error" role="alert">
          {panel.error || actionError}
        </p>
      ) : null}
      {notice ? (
        <p className="dashboard-alert is-success" role="status">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <p className="dashboard-table-empty" role="status">
          Loading Database...
        </p>
      ) : !database ? (
        <div className="dashboard-empty-state">
          <h3>No Database</h3>
          <p>
            A Project can have one private PostgreSQL 16 Database. Services in this Project receive
            a <code>DATABASE_URL</code>; nothing outside the Project network can connect.
          </p>
        </div>
      ) : (
        <>
          <div className="organization-table-wrap">
            <table className="organization-table">
              <thead>
                <tr>
                  <th>Engine</th>
                  <th>Status</th>
                  <th>Health</th>
                  <th>Storage</th>
                  <th>Created</th>
                  {canManage ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    PostgreSQL {database.version}
                    <small>
                      {database.username}@{database.databaseName}
                    </small>
                  </td>
                  <td>
                    <span className="role-label">{databaseStatusLabel(database.status)}</span>
                  </td>
                  <td>
                    <span
                      className={`dashboard-status ${database.healthy ? "is-active" : "is-error"}`}
                    >
                      <span className="dashboard-status-dot" aria-hidden="true" />
                      {database.healthy ? "Healthy" : "Unavailable"}
                    </span>
                  </td>
                  <td>
                    <div className="volume-usage">
                      <span>{usageLabel(database)}</span>
                      {database.usageMb !== null ? (
                        <span
                          className="volume-usage-bar"
                          aria-hidden="true"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round((database.usageMb / database.storageLimitMb) * 100),
                            )}%`,
                          }}
                        />
                      ) : null}
                    </div>
                    {database.overQuota ? (
                      <small className="dashboard-alert is-error">
                        Over the storage limit: the Database was stopped.
                      </small>
                    ) : null}
                  </td>
                  <td>{formatTime(database.createdAt)}</td>
                  {canManage ? (
                    <td>
                      <div className="deployment-actions">
                        <button
                          className="dashboard-link-button"
                          type="button"
                          onClick={() => void rotate()}
                          disabled={busy}
                        >
                          Rotate credentials
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="organization-settings-form environment-form">
            <label>
              Connection string (private)
              {database.connectionString ? (
                <input
                  value={database.connectionString}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                  spellCheck={false}
                />
              ) : (
                <span className="settings-readonly">
                  Only an owner or admin can view the connection string.
                </span>
              )}
            </label>
            <p>
              Reachable only from Services in this Project through the <code>db</code> host. It is
              injected automatically as <code>DATABASE_URL</code>; a user value cannot override it.
            </p>
          </div>

          <div className="organization-settings-form environment-form">
            <h3>Public proxy</h3>
            <p>
              {database.proxy.enabled
                ? `Enabled on port ${database.proxy.port}. Only the allowlisted addresses can connect, and the connection must use TLS.`
                : "Disabled. The Database has no public endpoint until an owner or admin enables it with at least one allowlist CIDR."}
            </p>

            {database.proxy.enabled ? (
              <label>
                Allowed CIDRs
                <input
                  value={database.proxy.allowlist.join(", ")}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                  spellCheck={false}
                />
              </label>
            ) : null}

            {canManage ? (
              <>
                <label>
                  Allowlist CIDRs (one per line)
                  <textarea
                    value={allowlist}
                    onChange={(event) => setAllowlistDraft(event.target.value)}
                    placeholder="203.0.113.0/24"
                    rows={3}
                    spellCheck={false}
                  />
                </label>
                <div className="deployment-actions">
                  <button
                    className="dashboard-link-button"
                    type="button"
                    onClick={() => void enableProxy()}
                    disabled={busy}
                  >
                    {database.proxy.enabled ? "Update allowlist" : "Enable public proxy"}
                  </button>
                  {database.proxy.enabled ? (
                    <button
                      className="dashboard-danger-button"
                      type="button"
                      onClick={() => void disableProxy()}
                      disabled={busy}
                    >
                      Disable public proxy
                    </button>
                  ) : null}
                </div>

                {database.proxy.enabled ? (
                  <label>
                    Connection string (public)
                    {database.proxy.connectionString ? (
                      <input
                        value={database.proxy.connectionString}
                        readOnly
                        onFocus={(event) => event.currentTarget.select()}
                        spellCheck={false}
                      />
                    ) : null}
                  </label>
                ) : null}
              </>
            ) : (
              <p className="settings-readonly">
                Only an owner or admin can enable the public proxy or view its connection string.
              </p>
            )}
          </div>

          {canManage ? (
            <div className="organization-settings-form">
              <label>
                Type <strong>{projectName}</strong> to delete this Database and its data
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button
                className="dashboard-danger-button"
                type="button"
                onClick={() => void remove()}
                disabled={busy || confirmation !== projectName}
              >
                {busy ? "Deleting..." : "Delete Database"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
