"use client";

import { useCallback, useEffect, useState } from "react";
import { useActiveMember, useActiveOrganization } from "@/lib/auth-client";
import { getBackups, type BackupList, type BackupSummary } from "@/lib/backups-client";
import { getRestores, requestRestore, type RestoreList } from "@/lib/restores-client";

function getError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function statusClass(status: string): string {
  if (status === "completed") return "running";
  if (status === "failed") return "failed";

  return "pending";
}

/** Restores that still occupy a target, so its button can be disabled. */
function isActive(status: string): boolean {
  return status === "pending" || status === "running";
}

type RestoreTarget = Pick<BackupSummary, "id" | "targetType" | "targetName" | "projectName">;

/**
 * Daily Backups of every Database, Volume, and the platform PostgreSQL, plus the
 * Restores started from them. The list shows the target, when it ran, its size,
 * and its status. When S3 is not configured the page warns that the local copy
 * does not survive losing the VPS.
 */
export default function BackupsPage() {
  const { data: organization } = useActiveOrganization();
  const { data: activeMember } = useActiveMember();
  const [list, setList] = useState<BackupList | null>(null);
  const [restores, setRestores] = useState<RestoreList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [target, setTarget] = useState<RestoreTarget | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const organizationId = organization?.id;
  const canRestore = activeMember?.role === "owner" || activeMember?.role === "admin";

  const refresh = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [nextList, nextRestores] = await Promise.all([getBackups(), getRestores()]);
      setList(nextList);
      setRestores(nextRestores);
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

  // A Restore runs in the worker, so the page polls while one is in flight to
  // show the final status without a manual refresh.
  const restoring = restores?.restores.some((restore) => isActive(restore.status)) ?? false;
  useEffect(() => {
    if (!restoring) return;

    const timer = setInterval(() => void refresh(), 5_000);

    return () => clearInterval(timer);
  }, [restoring, refresh]);

  function activeRestoreFor(backup: BackupSummary) {
    return restores?.restores.find(
      (restore) =>
        isActive(restore.status) &&
        restore.targetType === backup.targetType &&
        restore.targetName === backup.targetName &&
        restore.projectName === backup.projectName,
    );
  }

  function beginRestore(backup: BackupSummary) {
    setTarget(backup);
    setConfirmation("");
    setNotice("");
    setError("");
  }

  function cancelRestore() {
    setTarget(null);
    setConfirmation("");
  }

  async function submitRestore(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;

    setSubmitting(true);
    try {
      await requestRestore(target.id, confirmation);
      setNotice(
        `Restore of ${target.targetName} queued. The affected Services are stopped while it runs and start again afterwards.`,
      );
      setTarget(null);
      setConfirmation("");
      await refresh();
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="dashboard-content">
        <p className="dashboard-table-empty" role="status">
          Loading Backups...
        </p>
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      <div className="dashboard-page-heading">
        <div>
          <h1>Backups</h1>
          <p>
            Daily Backups for {organization?.name ?? "your Organization"}. Every Database, Volume,
            and the platform PostgreSQL is copied at 02.00 UTC and kept for seven days.
          </p>
        </div>
        <button className="dashboard-link-button" type="button" onClick={() => void refresh()}>
          Refresh
        </button>
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

      {list?.storageProvider === "local" ? (
        <p className="dashboard-alert" role="status">
          S3 credentials are not configured, so Backups are stored on this node only. They will not
          survive losing the VPS. Configure <code>S3_ENDPOINT</code>, <code>S3_BUCKET</code>,{" "}
          <code>S3_ACCESS_KEY_ID</code>, and <code>S3_SECRET_ACCESS_KEY</code> to store them off the
          node.
        </p>
      ) : null}

      {target ? (
        <form
          className="organization-settings-form environment-form"
          onSubmit={submitRestore}
          aria-labelledby="restore-heading"
        >
          <h2 id="restore-heading">Restore {target.targetName}</h2>
          <p className="dashboard-alert is-error">
            Restoring replaces the current data of {target.targetName} in{" "}
            {target.projectName ?? "this Project"} with the Backup. Every Service in the Project is
            stopped while the Restore runs, so the Project is unavailable until it finishes. This
            cannot be undone.
          </p>
          <label>
            Type <strong>{target.targetName}</strong> to confirm
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={target.targetName}
              required
            />
          </label>
          <div className="environment-form-actions">
            <button
              className="dashboard-danger-button"
              type="submit"
              disabled={submitting || confirmation.trim() !== target.targetName}
            >
              {submitting ? "Restoring..." : "Restore Backup"}
            </button>
            <button
              className="dashboard-link-button"
              type="button"
              onClick={cancelRestore}
              disabled={submitting}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <section className="dashboard-section" aria-labelledby="backups-heading">
        <div className="dashboard-section-heading">
          <h2 id="backups-heading">Backup list</h2>
        </div>

        {!list || list.backups.length === 0 ? (
          <div className="dashboard-empty-state">
            <h3>No Backups yet</h3>
            <p>The first daily Backup will appear here after 02.00 UTC.</p>
          </div>
        ) : (
          <div className="organization-table-wrap">
            <table className="organization-table">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Project</th>
                  <th>Taken</th>
                  <th>Size</th>
                  <th>Storage</th>
                  <th>Status</th>
                  {canRestore ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {list.backups.map((backup) => {
                  const restorable =
                    backup.targetType === "database" || backup.targetType === "volume";
                  const active = activeRestoreFor(backup);

                  return (
                    <tr key={backup.id}>
                      <td>{backup.targetName}</td>
                      <td>{backup.projectName ?? "Platform"}</td>
                      <td>{formatTime(backup.createdAt)}</td>
                      <td>
                        {backup.status === "completed" ? formatSize(backup.sizeBytes) : "-"}
                      </td>
                      <td>
                        <span className="role-label">
                          {backup.storageProvider === "s3"
                            ? "S3"
                            : backup.storageProvider === "local"
                              ? "Local"
                              : "-"}
                        </span>
                      </td>
                      <td>
                        <span className={`role-label is-${statusClass(backup.status)}`}>
                          {backup.status}
                        </span>
                        {backup.errorMessage ? (
                          <p className="project-quota-note">{backup.errorMessage}</p>
                        ) : null}
                      </td>
                      {canRestore ? (
                        <td>
                          {restorable && backup.status === "completed" ? (
                            <button
                              className="dashboard-link-button"
                              type="button"
                              onClick={() => beginRestore(backup)}
                              disabled={Boolean(active) || Boolean(target)}
                            >
                              {active ? "Restoring..." : "Restore"}
                            </button>
                          ) : (
                            <span className="project-quota-note">-</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="dashboard-section" aria-labelledby="restores-heading">
        <div className="dashboard-section-heading">
          <h2 id="restores-heading">Recent Restores</h2>
        </div>

        {!restores || restores.restores.length === 0 ? (
          <div className="dashboard-empty-state">
            <h3>No Restores yet</h3>
            <p>Restore a completed Database or Volume Backup from the list above.</p>
          </div>
        ) : (
          <div className="organization-table-wrap">
            <table className="organization-table">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Project</th>
                  <th>Requested</th>
                  <th>Finished</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {restores.restores.map((restore) => (
                  <tr key={restore.id}>
                    <td>{restore.targetName}</td>
                    <td>{restore.projectName ?? "-"}</td>
                    <td>{formatTime(restore.createdAt)}</td>
                    <td>{restore.finishedAt ? formatTime(restore.finishedAt) : "-"}</td>
                    <td>
                      <span className={`role-label is-${statusClass(restore.status)}`}>
                        {restore.status}
                      </span>
                      {restore.errorMessage ? (
                        <p className="project-quota-note">{restore.errorMessage}</p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
