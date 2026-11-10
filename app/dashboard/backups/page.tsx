"use client";

import { useCallback, useEffect, useState } from "react";
import { useActiveOrganization } from "@/lib/auth-client";
import { getBackups, type BackupList } from "@/lib/backups-client";

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

/**
 * Daily Backups of every Database, Volume, and the platform PostgreSQL. The
 * list shows the target, when it ran, its size, and its status. When S3 is not
 * configured the page warns that the local copy does not survive losing the VPS.
 */
export default function BackupsPage() {
  const { data: organization } = useActiveOrganization();
  const [list, setList] = useState<BackupList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const organizationId = organization?.id;

  const refresh = useCallback(async () => {
    if (!organizationId) return;
    try {
      setList(await getBackups());
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

      {list?.storageProvider === "local" ? (
        <p className="dashboard-alert" role="status">
          S3 credentials are not configured, so Backups are stored on this node only. They will not
          survive losing the VPS. Configure <code>S3_ENDPOINT</code>, <code>S3_BUCKET</code>,{" "}
          <code>S3_ACCESS_KEY_ID</code>, and <code>S3_SECRET_ACCESS_KEY</code> to store them off the
          node.
        </p>
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
                </tr>
              </thead>
              <tbody>
                {list.backups.map((backup) => (
                  <tr key={backup.id}>
                    <td>{backup.targetName}</td>
                    <td>{backup.projectName ?? "Platform"}</td>
                    <td>{formatTime(backup.createdAt)}</td>
                    <td>{backup.status === "completed" ? formatSize(backup.sizeBytes) : "-"}</td>
                    <td>
                      <span className="role-label">
                        {backup.storageProvider === "s3" ? "S3" : backup.storageProvider === "local" ? "Local" : "-"}
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
