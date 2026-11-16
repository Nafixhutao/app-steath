"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cpu, HardDrive, MemoryStick, Server } from "lucide-react";
import { getHostMetrics, type HostMetricNode } from "@/lib/admin-client";
import { AdminHeader, AdminPageBody } from "@/components/admin/admin-panel";
import { MetricCard } from "@/components/admin/metric-card";
import { LiveIndicator, RefreshButton } from "@/components/admin/live-indicator";

/** The windows the dashboard offers. Retention keeps one day. */
const WINDOWS = [
  { label: "1 hour", minutes: 60 },
  { label: "6 hours", minutes: 6 * 60 },
  { label: "24 hours", minutes: 24 * 60 },
  { label: "All", minutes: 0 },
] as const;

/** How often the panel re-reads the API while it stays open. */
const REFRESH_INTERVAL_MS = 15_000;

/** How many recent values each sparkline shows, oldest to newest. */
const SERIES_CAP = 60;

function getError(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function mebibytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} TiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GiB`;
  return `${Math.round(value)} MiB`;
}

/**
 * Platform Admin infrastructure dashboard. Every node shows its own CPU,
 * memory, and storage as cards with a sparkline of recent samples. The panel
 * polls every 15 seconds, so the numbers stay live without the worker being
 * involved.
 */
export function InfrastructurePanel() {
  const [windowMinutes, setWindowMinutes] = useState<number>(6 * 60);
  const [nodes, setNodes] = useState<HostMetricNode[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const report = await getHostMetrics(windowMinutes > 0 ? windowMinutes : undefined);
      setNodes(report.nodes);
      setError("");
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setLoading(false);
    }
  }, [windowMinutes]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <AdminPageBody>
      <AdminHeader
        title="Infrastructure"
        subtitle="How loaded each node itself is, sampled from the kernel and stored by the worker every minute."
      >
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="History window">
          {WINDOWS.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setWindowMinutes(option.minutes)}
              aria-pressed={windowMinutes === option.minutes}
              className={`h-9 rounded-lg border px-3 text-[12.5px] font-medium leading-none transition-colors ${
                windowMinutes === option.minutes
                  ? "border-[var(--projects-border-hover)] bg-[var(--projects-control)] text-[var(--projects-text)]"
                  : "border-[var(--projects-border)] bg-[#141416] text-[var(--projects-muted)] hover:border-[var(--projects-border-hover)] hover:text-[var(--projects-text)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <RefreshButton onClick={() => void refresh()} />
        <LiveIndicator live={!error} />
      </AdminHeader>

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !nodes ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3" aria-hidden="true">
          <div className="h-[118px] animate-pulse rounded-lg bg-white/[0.04]" />
          <div className="h-[118px] animate-pulse rounded-lg bg-white/[0.04]" />
          <div className="h-[118px] animate-pulse rounded-lg bg-white/[0.04]" />
        </div>
      ) : null}

      {nodes && nodes.length === 0 ? (
        <p className="admin-empty" role="status">
          No node has reported in yet. The Node Agent creates its node record with
          its first heartbeat, and the worker stores the first host sample within
          a minute of that.
        </p>
      ) : null}

      {nodes?.map((node) => (
        <NodeSection key={node.id} node={node} />
      ))}
    </AdminPageBody>
  );
}

function NodeSection({ node }: { node: HostMetricNode }) {
  const current = node.current;
  const history = useMemo(() => node.history ?? [], [node]);

  const tail = (pick: (sample: HostMetricNode["history"][number]) => number) =>
    history.slice(-SERIES_CAP).map(pick);

  return (
    <section className="flex flex-col gap-2.5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="m-0 flex min-w-0 items-center gap-2 text-[14px] font-semibold text-[var(--projects-text)]">
          <Server size={15} strokeWidth={1.8} aria-hidden="true" />
          {node.name}
        </h2>
        <span
          className={`admin-badge ${node.status === "healthy" ? "is-success" : "is-warning"}`}
        >
          <span className="admin-badge-dot" aria-hidden="true" />
          {node.status === "healthy" ? "Healthy" : "No recent heartbeat"}
        </span>
        {current ? (
          <span className="admin-mono ml-auto text-[11px] text-[var(--projects-muted)]">
            Sampled {formatTime(current.capturedAt)}
          </span>
        ) : null}
      </header>

      {current ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <MetricCard
            icon={Cpu}
            label="CPU"
            value={`${Math.round(current.cpuPercent)}%`}
            hint="Busy share across all cores"
            history={tail((sample) => sample.cpuPercent)}
            sparkTone="accent"
          />
          <MetricCard
            icon={MemoryStick}
            label="Memory"
            value={mebibytes(current.memoryUsedMb)}
            hint={`of ${mebibytes(current.memoryTotalMb)}`}
            history={tail((sample) => sample.memoryUsedMb)}
            sparkTone="info"
          />
          <MetricCard
            icon={HardDrive}
            label="Storage"
            value={mebibytes(current.storageUsedMb)}
            hint={`of ${mebibytes(current.storageTotalMb)}`}
            history={tail((sample) => sample.storageUsedMb)}
            sparkTone="neutral"
          />
        </div>
      ) : (
        <p className="admin-empty" role="status">
          No host sample in the selected window.{" "}
          {node.lastSeenAt
            ? `The node last reported in ${formatTime(node.lastSeenAt)}.`
            : "The node has never reported a heartbeat."}
        </p>
      )}
    </section>
  );
}
