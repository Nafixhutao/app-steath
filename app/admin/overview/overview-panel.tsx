"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  Cpu,
  HardDrive,
  MemoryStick,
  Server,
  XCircle,
} from "lucide-react";
import {
  getAdminOverview,
  getHostMetrics,
  type AdminOverview,
  type HostMetricNode,
} from "@/lib/admin-client";
import {
  AdminHeader,
  AdminPageBody,
  AdminPanel,
  AdminPanelHeader,
} from "@/components/admin/admin-panel";
import { MetricCard } from "@/components/admin/metric-card";
import { StatTile } from "@/components/admin/stat-tile";
import { LiveIndicator, RefreshButton } from "@/components/admin/live-indicator";
import { StatusBadge } from "@/components/admin/status-badge";

/** How often the panel re-reads the API while it stays open. */
const REFRESH_INTERVAL_MS = 15_000;

/** How many recent values each sparkline shows, oldest to newest. */
const SERIES_CAP = 60;

const RANGES = [
  { value: "60", label: "Last hour", minutes: 60, noun: "hour" },
  { value: "360", label: "Last 6 hours", minutes: 360, noun: "6 hours" },
  { value: "1440", label: "Last 24 hours", minutes: 1440, noun: "24 hours" },
] as const;

type RangeValue = (typeof RANGES)[number]["value"];

function getError(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

/** Deployment status → badge tone. */
function deploymentTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "running") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "queued") return "neutral";
  return "info";
}

/** Component status → badge tone. */
function componentTone(status: string): "success" | "warning" | "danger" {
  if (status === "ok") return "success";
  if (status === "down") return "danger";
  return "warning";
}

function relativeTime(value: string | null): string {
  if (!value) return "Never";
  const ms = Date.now() - new Date(value).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return formatTime(value);
}

/**
 * Admin Overview — platform health, host resources, and activity. Host
 * CPU/memory/storage come from the host-metrics endpoint; component status,
 * counts, and recent deployments come from the admin overview API.
 */
export function OverviewPanel() {
  const [range, setRange] = useState<RangeValue>("360");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [nodes, setNodes] = useState<HostMetricNode[] | null>(null);
  const [error, setError] = useState("");

  const rangeMeta = RANGES.find((option) => option.value === range);

  const refresh = useCallback(async () => {
    try {
      const [nextOverview, nextNodes] = await Promise.all([
        getAdminOverview(),
        getHostMetrics(rangeMeta?.minutes),
      ]);
      setOverview(nextOverview);
      setNodes(nextNodes.nodes);
      setError("");
    } catch (cause) {
      setError(getError(cause));
    }
  }, [rangeMeta]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const node = nodes?.[0];
  const current = node?.current ?? null;
  const history = useMemo(() => node?.history ?? [], [node]);

  const tail = (pick: (sample: HostMetricNode["history"][number]) => number) =>
    history.slice(-SERIES_CAP).map(pick);

  const counts = overview?.counts;
  const connected = !error;

  return (
    <AdminPageBody>
      <AdminHeader title="Admin Overview" subtitle="Monitor platform health, host resources, and activity.">
        <select
          aria-label="Time range"
          value={range}
          onChange={(event) => setRange(event.target.value as RangeValue)}
          className="admin-select-trigger"
        >
          {RANGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <RefreshButton onClick={() => void refresh()} />
        <LiveIndicator live={connected} />
      </AdminHeader>

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
        </p>
      ) : null}

      {/* Component health: API, database, node heartbeat. */}
      <section aria-label="Component status">
        {overview ? (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {overview.components.map((component) => (
              <AdminPanel key={component.component}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-[var(--projects-border)] bg-[var(--projects-control)] text-[var(--projects-muted)]">
                      <Server size={13} strokeWidth={1.8} aria-hidden="true" />
                    </span>
                    <h3 className="m-0 truncate text-[12.5px] font-medium text-[var(--projects-text)]">
                      {component.component}
                    </h3>
                  </div>
                  <StatusBadge tone={componentTone(component.status)} label={component.status} />
                </div>
                {component.detail ? (
                  <p className="m-0 mt-2 truncate text-[11.5px] text-[var(--projects-muted)]">
                    {component.detail}
                  </p>
                ) : null}
              </AdminPanel>
            ))}
          </div>
        ) : null}
      </section>

      {/* Host resources: the newest node's own CPU, memory, and storage. */}
      {node ? (
        <section aria-label="Host resources">
          <AdminPanelHeader
            title={`Host: ${node.name}`}
            right={
              <span className="admin-mono text-[11px] text-[var(--projects-muted)]">
                {node.status === "healthy" ? "Healthy" : "No recent heartbeat"}
                {current ? ` · sampled ${relativeTime(current.capturedAt)}` : ""}
              </span>
            }
          />
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <MetricCard
              icon={Cpu}
              label="CPU"
              value={current ? `${Math.round(current.cpuPercent)}%` : "—"}
              history={tail((sample) => sample.cpuPercent)}
              sparkTone="accent"
            />
            <MetricCard
              icon={MemoryStick}
              label="Memory"
              value={current ? mebibytes(current.memoryUsedMb) : "—"}
              hint={current ? `of ${mebibytes(current.memoryTotalMb)}` : undefined}
              history={tail((sample) => sample.memoryUsedMb)}
              sparkTone="info"
            />
            <MetricCard
              icon={HardDrive}
              label="Storage"
              value={current ? mebibytes(current.storageUsedMb) : "—"}
              hint={current ? `of ${mebibytes(current.storageTotalMb)}` : undefined}
              history={tail((sample) => sample.storageUsedMb)}
              sparkTone="neutral"
            />
          </div>
        </section>
      ) : null}

      {/* Platform counts. */}
      <section aria-label="Platform metrics">
        <AdminPanelHeader title="Platform" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatTile icon={Activity} label="Running deployments" value={String(counts?.deploymentsRunning ?? 0)} />
          <StatTile icon={Clock} label="Queued jobs" value={String(counts?.jobsQueued ?? 0)} tone="warning" />
          <StatTile
            icon={CheckCircle2}
            label="Running jobs"
            value={String(counts?.jobsRunning ?? 0)}
            tone="success"
          />
          <StatTile
            icon={XCircle}
            label="Failed jobs"
            value={String(counts?.jobsFailed ?? 0)}
            tone={counts && counts.jobsFailed > 0 ? "danger" : "neutral"}
          />
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatTile label="Users" value={String(counts?.users ?? 0)} />
          <StatTile label="Organizations" value={String(counts?.organizations ?? 0)} />
          <StatTile label="Projects" value={String(counts?.projects ?? 0)} />
          <StatTile label="Services" value={String(counts?.services ?? 0)} />
        </div>
      </section>

      {/* Recent activity: the newest deployments across all organizations. */}
      {overview && overview.recentDeployments.length > 0 ? (
        <AdminPanel flush>
          <div className="p-4 pb-3">
            <AdminPanelHeader title="Recent deployments" />
          </div>
          <div className="overflow-x-auto admin-scrollbar">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Organization</th>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Commit</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {overview.recentDeployments.map((deployment) => (
                  <tr key={deployment.id}>
                    <td className="font-medium">{deployment.serviceName}</td>
                    <td className="text-[var(--projects-muted)]">{deployment.organizationName}</td>
                    <td className="text-[var(--projects-muted)]">{deployment.projectName}</td>
                    <td>
                      <StatusBadge
                        tone={deploymentTone(deployment.status)}
                        label={deployment.status}
                      />
                    </td>
                    <td>
                      <span className="admin-mono text-[12px] text-[var(--projects-muted)]">
                        {deployment.commitSha ? deployment.commitSha.slice(0, 7) : "—"}
                      </span>
                    </td>
                    <td>
                      <span
                        title={formatTime(deployment.createdAt)}
                        className="admin-mono text-[12px] text-[var(--projects-muted)]"
                      >
                        {relativeTime(deployment.createdAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminPanel>
      ) : null}
    </AdminPageBody>
  );
}

function mebibytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} TiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GiB`;
  return `${Math.round(value)} MiB`;
}
