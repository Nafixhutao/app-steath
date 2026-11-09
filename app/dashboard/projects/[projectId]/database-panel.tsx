"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createProjectDatabase,
  databaseStatusLabel,
  deleteProjectDatabase,
  getProjectDatabase,
  rotateProjectDatabaseCredentials,
  type DatabaseSummary,
} from "@/lib/databases-client";

function getError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function usageLabel(database: DatabaseSummary): string {
  if (database.usageMb === null) {
    return "Unavailable — the node did not answer";
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
  const [database, setDatabase] = useState<DatabaseSummary | null>(null);
  const [redeployNeeded, setRedeployNeeded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await getProjectDatabase(projectId);
      setDatabase(result.database);
      setRedeployNeeded(result.needsRedeploy);
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

  async function create() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await createProjectDatabase(projectId);
      await load();
      setNotice("Database created.");
    } catch (cause) {
      setError(getError(cause));
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
    setError("");
    setNotice("");
    try {
      await rotateProjectDatabaseCredentials(projectId);
      await load();
      setNotice("Credentials rotated. Redeploy the Services to apply the new DATABASE_URL.");
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await deleteProjectDatabase(projectId, confirmation);
      setConfirmation("");
      await load();
      setNotice("Database deleted.");
    } catch (cause) {
      setError(getError(cause));
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
          Database changes are saved but not live yet — redeploy this Project&apos;s Services to
          apply them.
        </p>
      ) : null}

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
                  <td>{database.healthy ? "Healthy" : "Unavailable"}</td>
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
                        Over the storage limit — the Database was stopped.
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
