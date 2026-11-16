"use client";

import { useMemo, useState } from "react";
import { Clock, Cpu, HardDrive, MemoryStick, Network } from "lucide-react";
import {
  useAdminHostMetrics,
  useAdminIncidents,
  useAdminOverview,
} from "@/features/admin/data/admin-read-model";
import { AdminHeader, AdminPageBody } from "../components/admin-panel";
import { AdminSelect } from "../components/admin-select";
import { MetricCard } from "../components/metric-card";
import { MetricCardsSkeleton } from "../components/admin-skeletons";
import { StatTile } from "../components/stat-tile";
import {
  LiveIndicator,
  RefreshButton,
  UpdatedLabel,
} from "../components/live-indicator";
import { formatBytes } from "@/lib/format";
import { toIncident } from "../data/admin-read-model";
import { SystemStatus } from "./system-status";
import { ResourceOverview, type OverviewTab } from "./resource-overview";
import { DatabaseOverview } from "./database-overview";
import { RedisOverview } from "./redis-overview";
import { APIHealthOverview } from "./api-health-overview";
import { RecentDeployments } from "./recent-deployments";
import { ServiceHealthTable } from "./service-health-table";
import { RecentIncidents } from "./recent-incidents";
import type { MetricPoint } from "../types/telemetry";

const GIB = 1024 ** 3;
const KIB = 1024;
const MIB = 1024 ** 2;

/** Network rates render as a big number with a smaller unit beside it, so the
    pair stays on one line at any card width. MB/s kicks in above 1 MiB/s to
    keep the number itself short. */
function rateParts(bytesPerSec: number): { value: string; unit: string } {
  if (bytesPerSec >= MIB) {
    return { value: (bytesPerSec / MIB).toFixed(2), unit: "MB/s" };
  }
  return { value: (bytesPerSec / KIB).toFixed(1), unit: "KB/s" };
}

// The host metrics collector retains one hour, so only ranges within that
// window are offered — a wider choice would silently show the same data.
const OVERVIEW_RANGES = [
  { value: "5m", label: "Last 5 minutes", minutes: 5, noun: "5 minutes" },
  { value: "15m", label: "Last 15 minutes", minutes: 15, noun: "15 minutes" },
  { value: "1h", label: "Last 1 hour", minutes: 60, noun: "hour" },
] as const;
type OverviewRange = (typeof OVERVIEW_RANGES)[number]["value"];

type ChartSeriesMap = Record<OverviewTab, MetricPoint[]>;

/**
 * Admin Overview — platform health, host resources, and telemetry. Host
 * CPU/memory/disk/network come from the in-process host metrics endpoint (no
 * ClickHouse); component status, operations, and incidents come from the admin
 * API. Sandboxes/latency/error-rate tiles are intentionally absent because
 * Stealth does not expose those resources.
 */
export function AdminOverview() {
  const [range, setRange] = useState<OverviewRange>("1h");
  const [tab, setTab] = useState<OverviewTab>("cpu");

  const rangeMeta = OVERVIEW_RANGES.find((option) => option.value === range);

  const overview = useAdminOverview();
  const host = useAdminHostMetrics(rangeMeta?.minutes);
  const incidentsQuery = useAdminIncidents(
    { limit: 20 },
    { refetchInterval: 30_000 },
  );

  // The "Live" badge reflects real connectivity: any failing/again-loading
  // query flips it to amber instead of claiming a live connection.
  const connected =
    !overview.isError && !host.isError && !incidentsQuery.isError;

  const components = overview.data?.components ?? [];
  const operations = overview.data?.operations;
  const recentDeployments = overview.data?.recent_deployments;
  const current = host.data?.current;
  const history = useMemo(() => host.data?.history ?? [], [host.data]);
  const network = current
    ? rateParts(current.network_rx_bytes_per_sec)
    : undefined;

  const cpuHistory = useMemo(
    () => history.map((sample) => sample.cpu_percent),
    [history],
  );
  const memoryHistory = useMemo(
    () => history.map((sample) => sample.memory_used_bytes / GIB),
    [history],
  );
  const diskHistory = useMemo(
    () => history.map((sample) => sample.disk_used_bytes / GIB),
    [history],
  );
  const networkHistory = useMemo(
    () => history.map((sample) => sample.network_rx_bytes_per_sec / KIB),
    [history],
  );

  const chart = useMemo<ChartSeriesMap>(
    () => ({
      cpu: history.map((sample) => ({
        timestamp: sample.timestamp,
        value: sample.cpu_percent,
      })),
      memory: history.map((sample) => ({
        timestamp: sample.timestamp,
        value: sample.memory_used_bytes / GIB,
      })),
      network: history.map((sample) => ({
        timestamp: sample.timestamp,
        value: sample.network_rx_bytes_per_sec / KIB,
      })),
    }),
    [history],
  );

  const incidents = useMemo(
    () => (incidentsQuery.data?.items ?? []).map(toIncident),
    [incidentsQuery.data],
  );

  const rangeLabel = useMemo(
    () => rangeMeta?.label ?? range,
    [rangeMeta, range],
  );

  // Deltas for the metric-card change indicators, computed from the retained
  // history so the cards read like the redesign ("+4.2% from previous hour").
  // The first sample is a cold-start with no baseline (CPU/network read 0), so
  // rate metrics use the first non-zero sample as their baseline. Memoized
  // because it scans the whole window twice, on every poll and range change.
  const hasDelta = history.length >= 2 && Boolean(current);
  const { cpuBaseline, netBaseline } = useMemo(() => {
    const firstPositive = (
      pick: (sample: (typeof history)[number]) => number,
    ): (typeof history)[number] | undefined =>
      history.find((sample) => pick(sample) > 0) ?? history[0];
    return {
      cpuBaseline: firstPositive((sample) => sample.cpu_percent),
      netBaseline: firstPositive((sample) => sample.network_rx_bytes_per_sec),
    };
  }, [history]);
  const signed = (value: number, unit: string) =>
    `${value >= 0 ? "+" : ""}${Math.round(value * 10) / 10}${unit}`;
  const percentDelta = (now: number, before: number) =>
    before !== 0 ? ((now - before) / before) * 100 : 0;
  const memoryBaseline = history[0];
  const diskBaseline = history[0];
  const cpuDelta =
    hasDelta && current && cpuBaseline
      ? signed(current.cpu_percent - cpuBaseline.cpu_percent, "%")
      : undefined;
  const memoryDelta =
    hasDelta && current && memoryBaseline
      ? signed(
          percentDelta(
            current.memory_used_bytes,
            memoryBaseline.memory_used_bytes,
          ),
          "%",
        )
      : undefined;
  const diskDelta =
    hasDelta && current && diskBaseline
      ? signed(
          percentDelta(current.disk_used_bytes, diskBaseline.disk_used_bytes),
          "%",
        )
      : undefined;
  const networkDelta =
    hasDelta && current && netBaseline
      ? signed(
          (current.network_rx_bytes_per_sec -
            netBaseline.network_rx_bytes_per_sec) /
            KIB,
          " KB/s",
        )
      : undefined;

  return (
    <AdminPageBody>
      <AdminHeader
        title="Admin Overview"
        subtitle="Monitor platform health, host resources, and telemetry."
      >
        <AdminSelect
          label="Time range"
          icon={<Clock size={13} strokeWidth={1.8} aria-hidden="true" />}
          value={range}
          options={OVERVIEW_RANGES}
          onChange={setRange}
        />
        <RefreshButton
          onClick={() => {
            void overview.refetch();
            void host.refetch();
            void incidentsQuery.refetch();
          }}
        />
        <LiveIndicator live={connected} />
      </AdminHeader>

      <SystemStatus components={components} />

      {/* Infrastructure section: host resources, the database, the cache, and
          the API process itself. The section label matches "Platform" below. */}
      <div>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="m-0 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--projects-muted)]">
            Infrastructure
          </h2>
        </div>

        {/* Primary host resource metrics: 2 columns on phones; from lg up all
            four cards read as one row flowing 1-2-3-4 left to right. */}
        {host.isPending ? (
          <MetricCardsSkeleton />
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
            <MetricCard
              icon={Cpu}
              label="CPU Usage"
              value={current ? `${Math.round(current.cpu_percent)}%` : "—"}
              change={cpuDelta}
              changeLabel={`from previous ${rangeMeta?.noun ?? "hour"}`}
              changeTone="danger"
              history={cpuHistory}
              sparkTone="accent"
            />
            <MetricCard
              icon={MemoryStick}
              label="Memory"
              value={current ? formatBytes(current.memory_used_bytes) : "—"}
              change={memoryDelta}
              changeLabel={
                current
                  ? `of ${formatBytes(current.memory_total_bytes)}`
                  : undefined
              }
              changeTone="success"
              history={memoryHistory}
              sparkTone="info"
            />
            <MetricCard
              icon={HardDrive}
              label="Storage"
              value={current ? formatBytes(current.disk_used_bytes) : "—"}
              change={diskDelta}
              changeLabel={
                current
                  ? `of ${formatBytes(current.disk_total_bytes)}`
                  : undefined
              }
              changeTone="neutral"
              history={diskHistory}
              sparkTone="neutral"
            />
            <MetricCard
              icon={Network}
              label="Network"
              value={network?.value ?? "—"}
              unit={network?.unit}
              hint={
                current
                  ? `↑ ${(current.network_tx_bytes_per_sec / KIB).toFixed(1)} KB/s out`
                  : undefined
              }
              change={networkDelta}
              changeLabel={`ingress, from previous ${rangeMeta?.noun ?? "hour"}`}
              changeTone="neutral"
              history={networkHistory}
              sparkTone="warning"
            />
          </div>
        )}

        {/* The infra panels stack with breathing room between each other and
            the host card row above. */}
        <div className="mt-2.5 flex flex-col gap-2.5 sm:mt-3 sm:gap-3">
          <DatabaseOverview windowMinutes={rangeMeta?.minutes ?? 60} />
          <RedisOverview windowMinutes={rangeMeta?.minutes ?? 60} />
          <APIHealthOverview />
        </div>
      </div>

      {/* Platform metrics */}
      <div>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="m-0 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--projects-muted)]">
            Platform
          </h2>
          <UpdatedLabel
            resetKey={overview.data?.checked_at}
            className="admin-mono text-[11px] text-[var(--projects-muted)]"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Active deployments"
            value={String(operations?.active_deployments ?? 0)}
          />
          <StatTile
            label="Running jobs"
            value={String(operations?.running_jobs ?? 0)}
            tone="success"
          />
          <StatTile
            label="Failed jobs"
            value={String(operations?.failed_jobs ?? 0)}
            tone={
              operations && operations.failed_jobs > 0 ? "danger" : "neutral"
            }
          />
          <StatTile
            label="Queued jobs"
            value={String(operations?.queued_jobs ?? 0)}
            tone="warning"
          />
        </div>
        {/* Recent activity: the newest App deployments across all projects.
            Omitted entirely when the summary query did not answer. */}
        {recentDeployments && (
          <div className="mt-3">
            <RecentDeployments deployments={recentDeployments} />
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ResourceOverview
          series={chart}
          tab={tab}
          onTabChange={setTab}
          rangeLabel={rangeLabel}
          className="lg:col-span-2"
        />
        <RecentIncidents incidents={incidents} />
      </div>

      <ServiceHealthTable components={components} />
    </AdminPageBody>
  );
}
