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
    <div className="pt-[28px] pb-[64px] px-[36px] max-w-[1200px] mx-auto w-full">
      {/* Header */}
      <header className="flex items-center justify-between flex-wrap gap-[16px] mb-[24px]">
        <div className="flex items-center gap-3">
          <div className="w-[40px] h-[40px] rounded-panel bg-[rgba(62,207,142,0.1)] border border-[rgba(62,207,142,0.25)] flex items-center justify-center shrink-0" aria-hidden="true">
            <Archive className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-[22px]! font-semibold! text-ink tracking-[-0.015em]! m-0">Backups & Restores</h1>
            <p className="text-[13px] text-[#878492] mt-[4px] leading-[1.4]">
              Automated daily disaster recovery snapshots for{" "}
              {organization?.name ?? "your organization"}.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="supabase-btn-secondary font-medium focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] inline-flex items-center justify-center min-h-[38px] rounded-card border border-[#2a2834] bg-[#181720] [box-shadow:0_1px_2px_rgba(0,0,0,0.2)] whitespace-nowrap no-underline [transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease,color_120ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:border-[#3b3749] [&:hover:not(:disabled)]:bg-[#201e2a] [&:active:not(:disabled)]:translate-y-[1px] disabled:opacity-[0.5] disabled:transform-none"
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
        <div className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error my-4" role="alert">
          {error || submitError}
        </div>
      ) : null}

      {/* Local Storage Warning */}
      {list?.storageProvider === "local" && (
        <div className="flex items-start gap-[12px] py-[12px] px-[16px] rounded-card bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.25)] mb-[20px]" role="status">
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
        <div className="bg-surface border border-surface-raised rounded-panel py-[16px] px-[18px] flex flex-col gap-[6px] [transition:border-color_150ms_ease] hover:border-[#34313c]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#878492] uppercase tracking-[0.04em]">Total Backups</span>
            <Archive className="w-4 h-4 text-emerald-400" />
          </div>
          <span className="text-[22px] font-semibold text-ink tabular-nums leading-[1.2]">{backupsList.length}</span>
          <span className="text-[11px] text-zinc-500">Retained for 7 days</span>
        </div>

        <div className="bg-surface border border-surface-raised rounded-panel py-[16px] px-[18px] flex flex-col gap-[6px] [transition:border-color_150ms_ease] hover:border-[#34313c]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#878492] uppercase tracking-[0.04em]">Storage Backend</span>
            {list?.storageProvider === "s3" ? (
              <Cloud className="w-4 h-4 text-cyan-400" />
            ) : (
              <Server className="w-4 h-4 text-zinc-500" />
            )}
          </div>
          <span className="text-[22px] font-semibold text-ink tabular-nums leading-[1.2] text-sm font-mono mt-1">
            {list?.storageProvider === "s3" ? "S3 Object Storage" : "Local Node Storage"}
          </span>
          <span className="text-[11px] text-zinc-500">
            {list?.storageProvider === "s3"
              ? "Offsite redundancy active"
              : "Host directory storage"}
          </span>
        </div>

        <div className="bg-surface border border-surface-raised rounded-panel py-[16px] px-[18px] flex flex-col gap-[6px] [transition:border-color_150ms_ease] hover:border-[#34313c]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#878492] uppercase tracking-[0.04em]">Backup Schedule</span>
            <Clock className="w-4 h-4 text-zinc-400" />
          </div>
          <span className="text-[22px] font-semibold text-ink tabular-nums leading-[1.2] text-sm font-mono mt-1">Daily at 02:00 UTC</span>
          <span className="text-[11px] text-zinc-500">Automated cron worker</span>
        </div>

        <div className="bg-surface border border-surface-raised rounded-panel py-[16px] px-[18px] flex flex-col gap-[6px] [transition:border-color_150ms_ease] hover:border-[#34313c]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#878492] uppercase tracking-[0.04em]">Restores in Flight</span>
            <RotateCcw
              className={`w-4 h-4 ${restoring ? "text-amber-400 animate-spin" : "text-zinc-500"}`}
            />
          </div>
          <span className="text-[22px] font-semibold text-ink tabular-nums leading-[1.2]">
            {restores?.restores.filter((r) => isActive(r.status)).length ?? 0}
          </span>
          <span className="text-[11px] text-zinc-500">
            {restoring ? "Restoration in progress" : "No active restores"}
          </span>
        </div>
      </section>

      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-[12px] mb-[16px]">
        <div className="relative w-full max-w-[340px]">
          <Search className="absolute left-[12px] top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-[#706d7e] pointer-events-none" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search backups by target or project..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="backups-search-input bg-surface w-full h-[36px] py-0 pr-[32px] pl-[36px] rounded-control border border-surface-raised text-ink-console text-[13px]! outline-none [transition:border-color_150ms_ease] focus:border-[var(--color-accent)]"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-[10px] top-1/2 -translate-y-1/2 text-[#706d7e] bg-transparent border-0 cursor-pointer p-[2px] flex items-center justify-center hover:text-ink-console"
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
            className="supabase-filter-select bg-surface h-[34px] py-0 pr-[28px] pl-[10px] rounded-control border border-[#282631] text-[#c9c7d2] text-[13px] cursor-pointer outline-none"
            aria-label="Filter by target type"
          >
            <option value="all">All Targets</option>
            <option value="database">Databases</option>
            <option value="volume">Volumes</option>
          </select>

          <span className="bg-[#1d1b22] inline-flex items-center h-[24px] py-0 px-[10px] rounded-[9999px] text-[11px] font-medium border border-[#282632] text-[#878492]">{filteredBackups.length} Snapshots</span>
        </div>
      </div>

      {/* Backups Table Card */}
      <div className="bg-surface border border-surface-raised rounded-panel overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-4" aria-label="Loading backups">
            {[1, 2, 3].map((n) => (
              <div key={n} className="flex items-center gap-3">
                <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] w-8 h-8 rounded flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-4 w-32 rounded" />
                  <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-3 w-48 rounded" />
                </div>
                <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-6 w-16 rounded" />
              </div>
            ))}
          </div>
        ) : filteredBackups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-[48px] px-[20px] text-center">
            <Archive className="w-8 h-8 text-zinc-600 mb-2" />
            <p className="text-sm text-zinc-300 font-medium">No backups found</p>
            <p className="text-xs text-zinc-500 mt-1">
              {search
                ? "No snapshot matches your search query."
                : "The first automated daily snapshot will be captured at 02:00 UTC."}
            </p>
          </div>
        ) : (
          <table className="backups-table w-full text-left [&_th]:px-[18px] [&_th]:py-[12px] [&_th]:text-[11px] [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-[0.05em] [&_th]:text-[#878492] [&_th]:border-b [&_th]:border-[var(--color-surface-raised)] [&_th]:bg-[#131217] [&_td]:px-[18px] [&_td]:py-[14px] [&_td]:border-b [&_td]:border-[#1f1d25] [&_td]:text-[13px] [&_td]:align-middle [&_tr:hover>td]:bg-[rgba(255,255,255,0.015)] [&_tr:last-child>td]:border-b-0">
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
                        <div className="w-[30px] h-[30px] rounded-control bg-[#1f1d26] border border-[#2d2a37] flex items-center justify-center shrink-0" aria-hidden="true">
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
                      <span className="inline-flex items-center h-[20px] py-0 px-[7px] rounded-control-sm text-[10px] [font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace] font-semibold uppercase bg-[#1f1d27] border border-[#2d2b37] text-[#a6a3b0]">
                        {backup.storageProvider === "s3" ? "S3" : "Local"}
                      </span>
                    </td>

                    <td>
                      <span
                        className={`backups-status-pill inline-flex items-center gap-[6px] h-[22px] py-0 px-[8px] rounded-[9999px] text-[11px] font-medium ${
                          isSuccess
                            ? "is-completed bg-[#0f2e21] border border-[#1d4a36] text-[var(--color-accent)]"
                            : backup.status === "failed"
                              ? "is-failed bg-[#2d1419] border border-[#4d222a] text-[var(--color-danger)]"
                              : "is-pending bg-[#2a2012] border border-[#48381c] text-[var(--color-warning)]"
                        }`}
                      >
                        <span className="project-status-dot bg-current w-[6px] h-[6px] rounded-[50%]" aria-hidden="true" />
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
                            className="supabase-btn-secondary font-medium focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] inline-flex items-center justify-center min-h-[38px] rounded-card border border-[#2a2834] bg-[#181720] [box-shadow:0_1px_2px_rgba(0,0,0,0.2)] whitespace-nowrap no-underline [transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease,color_120ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:border-[#3b3749] [&:hover:not(:disabled)]:bg-[#201e2a] [&:active:not(:disabled)]:translate-y-[1px] disabled:opacity-[0.5] disabled:transform-none text-xs h-7 px-2.5"
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
            <span className="bg-[#1d1b22] inline-flex items-center h-[24px] py-0 px-[10px] rounded-[9999px] text-[11px] font-medium border border-[#282632] text-[#878492]">{restores.restores.length}</span>
          </div>

          <div className="bg-surface border border-surface-raised rounded-panel overflow-hidden">
            <table className="backups-table w-full text-left [&_th]:px-[18px] [&_th]:py-[12px] [&_th]:text-[11px] [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-[0.05em] [&_th]:text-[#878492] [&_th]:border-b [&_th]:border-[var(--color-surface-raised)] [&_th]:bg-[#131217] [&_td]:px-[18px] [&_td]:py-[14px] [&_td]:border-b [&_td]:border-[#1f1d25] [&_td]:text-[13px] [&_td]:align-middle [&_tr:hover>td]:bg-[rgba(255,255,255,0.015)] [&_tr:last-child>td]:border-b-0">
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
                          className={`backups-status-pill inline-flex items-center gap-[6px] h-[22px] py-0 px-[8px] rounded-[9999px] text-[11px] font-medium ${
                            isDone ? "is-completed bg-[#0f2e21] border border-[#1d4a36] text-[var(--color-accent)]" : isFail ? "is-failed bg-[#2d1419] border border-[#4d222a] text-[var(--color-danger)]" : "is-pending bg-[#2a2012] border border-[#48381c] text-[var(--color-warning)]"
                          }`}
                        >
                          <span className="project-status-dot bg-current w-[6px] h-[6px] rounded-[50%]" aria-hidden="true" />
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
          <div className="supabase-modal-header flex items-center justify-between py-[18px] px-[20px] border-rose-900/40">
            <div className="flex items-center gap-2 text-rose-400">
              <RotateCcw className="w-4 h-4" />
              <h2 id="restore-modal-title">Restore {target.targetName}</h2>
            </div>
            <button
              type="button"
              className="supabase-modal-close flex items-center justify-center w-[28px] h-[28px] rounded-control bg-transparent border-0 text-[#716f7c] cursor-pointer [transition:color_150ms,background-color_150ms] hover:text-ink-console"
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
                <label htmlFor="confirm-restore-input" className="block text-[13px] font-medium text-[#c9c7d2] mb-[6px]">
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
                  className="supabase-modal-input w-full h-[38px] py-0 px-[12px] rounded-control bg-[#1a1920] text-ink outline-none [transition:border-color_150ms] border-rose-900/50 focus:border-rose-500"
                  autoFocus
                />
              </div>
            </div>

            <div className="supabase-modal-footer">
              <button
                type="button"
                className="supabase-btn-secondary font-medium focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] inline-flex items-center justify-center min-h-[38px] rounded-card border border-[#2a2834] bg-[#181720] [box-shadow:0_1px_2px_rgba(0,0,0,0.2)] whitespace-nowrap no-underline [transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease,color_120ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:border-[#3b3749] [&:hover:not(:disabled)]:bg-[#201e2a] [&:active:not(:disabled)]:translate-y-[1px] disabled:opacity-[0.5] disabled:transform-none"
                onClick={cancelRestore}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--color-danger)] focus-visible:outline-offset-[2px] disabled:opacity-[0.5] disabled:cursor-not-allowed inline-flex items-center justify-center gap-[8px] min-h-[38px] py-[8px] px-[16px] rounded-card border-0 bg-[#e11d48] [background-image:linear-gradient(180deg,var(--color-danger)_0%,#e11d48_100%)] [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.25),0_1px_3px_rgba(0,0,0,0.3),0_0_0_1px_#be123c] text-ink text-[13.5px]! font-medium! whitespace-nowrap [transition:background-color_150ms_ease,box-shadow_150ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:[background-image:linear-gradient(180deg,#fb7185_0%,var(--color-danger)_100%)] [&:hover:not(:disabled)]:text-ink [&:active:not(:disabled)]:translate-y-[1] disabled:transform-none disabled:[box-shadow:none]"
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
