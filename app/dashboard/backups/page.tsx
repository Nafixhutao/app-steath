"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Database,
  HardDrive,
  RotateCcw,
  RefreshCw,
  AlertTriangle,
  Clock,
  Search,
  X,
  Loader2,
  Layers,
  Cloud,
  Server,
} from "lucide-react";
import { useActiveMember, useActiveOrganization } from "@/lib/auth-client";
import { getError, useResource } from "@/lib/resource";
import { getBackups, type BackupSummary } from "@/lib/backups-client";
import { getRestores, requestRestore } from "@/lib/restores-client";
import { formatDateTime } from "@/lib/format";
import { useToast } from "@/components/toast-context";
import { ModalDialog } from "@/components/supabase-modal";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function isActive(status: string): boolean {
  return status === "pending" || status === "running";
}

type RestoreTarget = Pick<BackupSummary, "id" | "targetType" | "targetName" | "projectName">;

export default function BackupsPage() {
  const { toast } = useToast();
  const { data: organization } = useActiveOrganization();
  const { data: activeMember } = useActiveMember();

  const [target, setTarget] = useState<RestoreTarget | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const organizationId = organization?.id;
  // Better Auth stores multiple roles as a comma-separated string, so check the
  // parsed set rather than the raw value.
  const canRestore =
    activeMember?.role
      .split(",")
      .some((role) => role.trim() === "owner" || role.trim() === "admin") ?? false;

  const board = useResource(
    useCallback(async () => {
      const [nextList, nextRestores] = await Promise.all([getBackups(), getRestores()]);
      return { backups: nextList, restores: nextRestores };
    }, []),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );

  const list = board.data?.backups ?? null;
  const restores = board.data?.restores ?? null;
  const loading = board.loading;
  const error = board.error;

  const restoring = restores?.restores.some((restore) => isActive(restore.status)) ?? false;
  const refreshBoard = board.refresh;

  useEffect(() => {
    if (!restoring) return;
    const timer = setInterval(() => void refreshBoard(), 5000);
    return () => clearInterval(timer);
  }, [restoring, refreshBoard]);

  const backupsList = useMemo(() => list?.backups ?? [], [list?.backups]);

  const filteredBackups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return backupsList.filter((b) => {
      if (typeFilter !== "all" && b.targetType !== typeFilter) return false;
      if (!q) return true;
      return (
        b.targetName.toLowerCase().includes(q) ||
        (b.projectName && b.projectName.toLowerCase().includes(q))
      );
    });
  }, [backupsList, search, typeFilter]);

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
    setSubmitError("");
  }

  function cancelRestore() {
    setTarget(null);
    setConfirmation("");
    setSubmitError("");
  }

  async function submitRestore(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;

    setSubmitting(true);
    setSubmitError("");
    try {
      await requestRestore(target.id, confirmation);
      toast.success(
        "Restore queued",
        `Restore of ${target.targetName} scheduled. Services will restart automatically after completion.`,
      );
      setTarget(null);
      setConfirmation("");
      await board.refresh();
    } catch (cause) {
      setSubmitError(getError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="backups-page-container">
      {/* Header */}
      <header className="backups-page-header">
        <div className="flex items-center gap-3">
          <div className="backups-header-icon" aria-hidden="true">
            <Archive className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="backups-page-title">Backups & Restores</h1>
            <p className="backups-page-subtitle">
              Automated daily disaster recovery snapshots for{" "}
              {organization?.name ?? "your organization"}.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="supabase-btn-secondary"
          onClick={() => void board.refresh()}
          disabled={loading}
          title="Refresh backup records"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </header>

      {/* Global Alerts */}
      {error || submitError ? (
        <div className="dashboard-alert is-error my-4" role="alert">
          {error || submitError}
        </div>
      ) : null}

      {/* Local Storage Warning */}
      {list?.storageProvider === "local" && (
        <div className="backups-warning-banner" role="status">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-200">
            <strong>Local Storage Notice:</strong> S3 credentials are not configured, so backup
            archives are stored on this node only. They will not survive catastrophic VPS disk
            failure. Configure S3 environment variables to persist backups off-site.
          </div>
        </div>
      )}

      {/* Overview Cards */}
      <section
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6"
        aria-label="Backup metrics"
      >
        <div className="backups-metric-card">
          <div className="flex items-center justify-between">
            <span className="backups-metric-label">Total Backups</span>
            <Archive className="w-4 h-4 text-emerald-400" />
          </div>
          <span className="backups-metric-val">{backupsList.length}</span>
          <span className="text-[11px] text-zinc-500">Retained for 7 days</span>
        </div>

        <div className="backups-metric-card">
          <div className="flex items-center justify-between">
            <span className="backups-metric-label">Storage Backend</span>
            {list?.storageProvider === "s3" ? (
              <Cloud className="w-4 h-4 text-cyan-400" />
            ) : (
              <Server className="w-4 h-4 text-zinc-500" />
            )}
          </div>
          <span className="backups-metric-val text-sm font-mono mt-1">
            {list?.storageProvider === "s3" ? "S3 Object Storage" : "Local Node Storage"}
          </span>
          <span className="text-[11px] text-zinc-500">
            {list?.storageProvider === "s3"
              ? "Offsite redundancy active"
              : "Host directory storage"}
          </span>
        </div>

        <div className="backups-metric-card">
          <div className="flex items-center justify-between">
            <span className="backups-metric-label">Backup Schedule</span>
            <Clock className="w-4 h-4 text-zinc-400" />
          </div>
          <span className="backups-metric-val text-sm font-mono mt-1">Daily at 02:00 UTC</span>
          <span className="text-[11px] text-zinc-500">Automated cron worker</span>
        </div>

        <div className="backups-metric-card">
          <div className="flex items-center justify-between">
            <span className="backups-metric-label">Restores in Flight</span>
            <RotateCcw
              className={`w-4 h-4 ${restoring ? "text-amber-400 animate-spin" : "text-zinc-500"}`}
            />
          </div>
          <span className="backups-metric-val">
            {restores?.restores.filter((r) => isActive(r.status)).length ?? 0}
          </span>
          <span className="text-[11px] text-zinc-500">
            {restoring ? "Restoration in progress" : "No active restores"}
          </span>
        </div>
      </section>

      {/* Toolbar */}
      <div className="backups-toolbar">
        <div className="backups-search-box">
          <Search className="backups-search-icon" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search backups by target or project..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="backups-search-input"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="backups-search-clear"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2.5">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="supabase-filter-select"
            aria-label="Filter by target type"
          >
            <option value="all">All Targets</option>
            <option value="database">Databases</option>
            <option value="volume">Volumes</option>
          </select>

          <span className="backups-count-pill">{filteredBackups.length} Snapshots</span>
        </div>
      </div>

      {/* Backups Table Card */}
      <div className="backups-table-card">
        {loading ? (
          <div className="p-6 space-y-4" aria-label="Loading backups">
            {[1, 2, 3].map((n) => (
              <div key={n} className="flex items-center gap-3">
                <div className="supabase-skeleton-box w-8 h-8 rounded flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="supabase-skeleton-box h-4 w-32 rounded" />
                  <div className="supabase-skeleton-box h-3 w-48 rounded" />
                </div>
                <div className="supabase-skeleton-box h-6 w-16 rounded" />
              </div>
            ))}
          </div>
        ) : filteredBackups.length === 0 ? (
          <div className="backups-empty-box">
            <Archive className="w-8 h-8 text-zinc-600 mb-2" />
            <p className="text-sm text-zinc-300 font-medium">No backups found</p>
            <p className="text-xs text-zinc-500 mt-1">
              {search
                ? "No snapshot matches your search query."
                : "The first automated daily snapshot will be captured at 02:00 UTC."}
            </p>
          </div>
        ) : (
          <table className="backups-table">
            <thead>
              <tr>
                <th scope="col">Target</th>
                <th scope="col">Project</th>
                <th scope="col">Captured</th>
                <th scope="col">Size</th>
                <th scope="col">Storage</th>
                <th scope="col">Status</th>
                {canRestore ? (
                  <th scope="col" className="text-right">
                    Action
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {filteredBackups.map((backup) => {
                const isDb = backup.targetType === "database";
                const isVolume = backup.targetType === "volume";
                const restorable = isDb || isVolume;
                const active = activeRestoreFor(backup);
                const isSuccess = backup.status === "completed";

                return (
                  <tr key={backup.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="backups-row-icon" aria-hidden="true">
                          {isDb ? (
                            <Database className="w-3.5 h-3.5 text-blue-400" />
                          ) : (
                            <HardDrive className="w-3.5 h-3.5 text-amber-400" />
                          )}
                        </div>
                        <div>
                          <span className="font-medium text-white text-xs">
                            {backup.targetName}
                          </span>
                          <span className="text-[11px] text-zinc-500 block capitalize">
                            {backup.targetType}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td>
                      <div className="flex items-center gap-1.5 text-xs text-zinc-300">
                        <Layers className="w-3 h-3 text-zinc-500" />
                        <span>{backup.projectName ?? "Platform"}</span>
                      </div>
                    </td>

                    <td className="text-xs text-zinc-400 font-mono">
                      {formatDateTime(backup.createdAt)}
                    </td>

                    <td className="text-xs font-mono text-zinc-300">
                      {backup.status === "completed" ? formatSize(backup.sizeBytes) : "-"}
                    </td>

                    <td>
                      <span className="backups-storage-badge">
                        {backup.storageProvider === "s3" ? "S3" : "Local"}
                      </span>
                    </td>

                    <td>
                      <span
                        className={`backups-status-pill ${
                          isSuccess
                            ? "is-completed"
                            : backup.status === "failed"
                              ? "is-failed"
                              : "is-pending"
                        }`}
                      >
                        <span className="project-status-dot" aria-hidden="true" />
                        <span className="capitalize">{backup.status}</span>
                      </span>
                      {backup.errorMessage ? (
                        <p className="text-[11px] text-rose-400 mt-1 max-w-xs">
                          {backup.errorMessage}
                        </p>
                      ) : null}
                    </td>

                    {canRestore ? (
                      <td className="text-right">
                        {restorable && isSuccess ? (
                          <button
                            type="button"
                            className="supabase-btn-secondary text-xs h-7 px-2.5"
                            onClick={() => beginRestore(backup)}
                            disabled={Boolean(active) || Boolean(target)}
                          >
                            <RotateCcw className={`w-3 h-3 mr-1 ${active ? "animate-spin" : ""}`} />
                            <span>{active ? "Restoring..." : "Restore"}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-zinc-600">-</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent Restores History */}
      {restores && restores.restores.length > 0 && (
        <section className="mt-8 space-y-3" aria-labelledby="recent-restores-heading">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-cyan-400" />
            <h2 id="recent-restores-heading" className="text-sm font-semibold text-white">
              Recent Restores
            </h2>
            <span className="backups-count-pill">{restores.restores.length}</span>
          </div>

          <div className="backups-table-card">
            <table className="backups-table">
              <thead>
                <tr>
                  <th scope="col">Target</th>
                  <th scope="col">Project</th>
                  <th scope="col">Requested</th>
                  <th scope="col">Finished</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {restores.restores.map((restore) => {
                  const isDone = restore.status === "completed";
                  const isFail = restore.status === "failed";

                  return (
                    <tr key={restore.id}>
                      <td>
                        <span className="font-medium text-white text-xs">{restore.targetName}</span>
                      </td>
                      <td className="text-xs text-zinc-300">{restore.projectName ?? "Platform"}</td>
                      <td className="text-xs font-mono text-zinc-400">
                        {formatDateTime(restore.createdAt)}
                      </td>
                      <td className="text-xs font-mono text-zinc-400">
                        {restore.finishedAt ? formatDateTime(restore.finishedAt) : "-"}
                      </td>
                      <td>
                        <span
                          className={`backups-status-pill ${
                            isDone ? "is-completed" : isFail ? "is-failed" : "is-pending"
                          }`}
                        >
                          <span className="project-status-dot" aria-hidden="true" />
                          <span className="capitalize">{restore.status}</span>
                        </span>
                        {restore.errorMessage ? (
                          <p className="text-[11px] text-rose-400 mt-1 max-w-xs">
                            {restore.errorMessage}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Modal: Restore Confirmation */}
      {target && (
        <ModalDialog labelledBy="restore-modal-title" onClose={cancelRestore}>
          <div className="supabase-modal-header border-rose-900/40">
            <div className="flex items-center gap-2 text-rose-400">
              <RotateCcw className="w-4 h-4" />
              <h2 id="restore-modal-title">Restore {target.targetName}</h2>
            </div>
            <button
              type="button"
              className="supabase-modal-close"
              onClick={cancelRestore}
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={submitRestore}>
            <div className="supabase-modal-body space-y-3.5">
              <div className="p-3 rounded-lg bg-rose-950/25 border border-rose-900/50 text-rose-200 text-xs leading-relaxed">
                <strong>Warning:</strong> Restoring will overwrite the current live data of{" "}
                <strong>{target.targetName}</strong> with this snapshot. Services attached to it in{" "}
                <strong>{target.projectName ?? "this project"}</strong> will be stopped temporarily
                and will restart automatically once completed. This operation cannot be undone.
              </div>

              <div>
                <label htmlFor="confirm-restore-input" className="supabase-modal-label">
                  Type <strong>{target.targetName}</strong> to confirm:
                </label>
                <input
                  id="confirm-restore-input"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder={target.targetName}
                  autoComplete="off"
                  spellCheck="false"
                  required
                  className="supabase-modal-input border-rose-900/50 focus:border-rose-500"
                  autoFocus
                />
              </div>
            </div>

            <div className="supabase-modal-footer">
              <button
                type="button"
                className="supabase-btn-secondary"
                onClick={cancelRestore}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="project-btn-danger"
                disabled={submitting || confirmation.trim() !== target.targetName}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Restoring...
                  </>
                ) : (
                  "Restore Snapshot"
                )}
              </button>
            </div>
          </form>
        </ModalDialog>
      )}
    </div>
  );
}
