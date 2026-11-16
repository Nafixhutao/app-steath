"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Clock,
  Database,
  Gauge,
  Terminal,
  Users,
  Zap,
} from "lucide-react";
import { useAdminDBMetrics } from "@/features/admin/data/admin-read-model";
import { formatBytes } from "@/lib/format";
import { AdminPanel } from "../components/admin-panel";
import { Sparkline } from "../components/sparkline";
import {
  Delta,
  HealthPill,
  InfraPanelSkeleton,
  InfraTile,
  TileBar,
  TileValue,
  deltaParts,
  uptimeLabel,
  versionLabel,
  windowSuffix,
  windowSuffixShort,
} from "./infra-shared";

/**
 * Admin Overview database panel, laid out like the reference design: a header
 * with the PostgreSQL elephant, a metric grid, and a wide size card with a
 * growth sparkline. Every number comes from PostgreSQL's own statistics
 * through the API's in-process sampler; nothing is mocked.
 */
export function DatabaseOverview({ windowMinutes }: { windowMinutes: number }) {
  const query = useAdminDBMetrics(windowMinutes);
  const snapshot = query.data;
  const current = snapshot?.current;
  const history = useMemo(() => snapshot?.history ?? [], [snapshot]);

  // The sampler answers in tens of milliseconds, so a bare isPending check
  // makes the skeleton flash invisibly. Hold it for a short minimum window on
  // first load only; background refetches never re-show it, and an error
  // dismisses it immediately so the unavailable state is not delayed.
  const [minSkeletonWindow, setMinSkeletonWindow] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setMinSkeletonWindow(false), 900);
    return () => clearTimeout(timer);
  }, []);
  const showSkeleton =
    !query.isError && !snapshot && (query.isPending || minSkeletonWindow);

  const reachable = Boolean(snapshot?.reachable) && Boolean(current);
  const health = reachable
    ? { tone: "success" as const, label: "Healthy" }
    : query.isPending
      ? ({ tone: "neutral" as const, label: "Checking…" } as const)
      : ({ tone: "danger" as const, label: "Unavailable" } as const);

  const connectionPercent =
    current && current.max_connections > 0
      ? (current.connections / current.max_connections) * 100
      : 0;

  const sizeHistory = useMemo(
    () => history.map((sample) => sample.database_size_bytes / 1024 ** 3),
    [history],
  );

  const suffix = windowSuffix(windowMinutes);
  const shortSuffix = windowSuffixShort(windowMinutes);
  const latencyDelta = useMemo(() => {
    if (history.length < 2) return undefined;
    return deltaParts(
      history[history.length - 1].query_latency_ms,
      history[0].query_latency_ms,
      false,
    );
  }, [history]);
  const transactionsDelta = useMemo(() => {
    if (history.length < 2) return undefined;
    return deltaParts(
      history[history.length - 1].transactions_per_sec,
      history[0].transactions_per_sec,
      true,
    );
  }, [history]);
  const sizeDelta = useMemo(() => {
    if (history.length < 2) return undefined;
    return deltaParts(
      history[history.length - 1].database_size_bytes,
      history[0].database_size_bytes,
      true,
    );
  }, [history]);

  return (
    <AdminPanel className="p-3 sm:p-5">
      {/* Header: elephant logo, title, version, health pill. On phones the
          pill drops below the title block instead of squeezing it. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 pb-3.5 sm:pb-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl sm:size-14"
          >
            <Image
              src="/postgresql.svg"
              alt=""
              width={34}
              height={34}
              unoptimized
              className="size-[26px] object-contain sm:size-[34px]"
            />
          </span>
          <div className="min-w-0">
            <h2 className="m-0 truncate text-[16px] font-bold leading-5 tracking-[-0.01em] text-[var(--projects-text)] sm:text-[19px] sm:leading-6">
              Database (PostgreSQL)
            </h2>
            <p className="m-0 mt-0.5 truncate text-[12px] leading-4 text-[var(--projects-muted)] sm:mt-1 sm:text-[13px]">
              Primary database
              {snapshot?.server_version
                ? ` • ${versionLabel(snapshot.server_version, "PostgreSQL")}`
                : ""}
              {reachable && current && current.uptime_seconds > 0
                ? ` • up ${uptimeLabel(current.uptime_seconds)}`
                : ""}
            </p>
          </div>
        </div>
        <HealthPill tone={health.tone} label={health.label} />
      </div>

      {showSkeleton ? (
        <InfraPanelSkeleton count={6} />
      ) : !reachable ? (
        <p className="m-0 pb-2 text-[13px] leading-5 text-[var(--projects-muted)]">
          Database metrics are unavailable right now. The sampler could not
          reach PostgreSQL; the panel recovers automatically once queries
          succeed again.
        </p>
      ) : (
        <div className="flex flex-col gap-2 sm:gap-3">
          {/* 4-across on desktop so the tiles line up with the host cards; 2
              columns on phones keep tiles readable. */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            <InfraTile icon={Users} label="Connections">
              <TileValue
                value={String(current?.connections ?? 0)}
                unit={`/ ${current?.max_connections ?? 0}`}
              />
              <TileBar percent={connectionPercent} />
              <p className="m-0 truncate text-[12px] leading-4 text-[var(--projects-muted)]">
                {Math.round(connectionPercent)}% utilization
              </p>
            </InfraTile>

            <InfraTile icon={Terminal} label="Active Queries">
              <TileValue value={String(current?.active_queries ?? 0)} />
              <p className="m-0 truncate text-[12px] leading-4 text-[var(--projects-muted)]">
                Running now
              </p>
            </InfraTile>

            <InfraTile icon={Clock} label="Query Latency">
              <TileValue
                value={
                  current && current.query_latency_ms > 0
                    ? String(Math.round(current.query_latency_ms))
                    : "—"
                }
                unit={
                  current && current.query_latency_ms > 0 ? "ms" : undefined
                }
              />
              <Delta
                parts={latencyDelta}
                suffix={suffix}
                shortSuffix={shortSuffix}
              />
            </InfraTile>

            <InfraTile icon={Gauge} label="Cache Hit Ratio">
              <TileValue
                value={
                  current?.cache_hit_ratio_known
                    ? current.cache_hit_ratio_percent.toFixed(1)
                    : "—"
                }
                unit={current?.cache_hit_ratio_known ? "%" : undefined}
              />
              {current?.cache_hit_ratio_known ? (
                <TileBar
                  percent={current.cache_hit_ratio_percent}
                  higherIsBetter
                />
              ) : (
                <p className="m-0 truncate text-[12px] leading-4 text-[var(--projects-muted)]">
                  Not enough reads yet
                </p>
              )}
            </InfraTile>

            <InfraTile icon={Activity} label="Transactions/sec">
              <TileValue
                value={String(Math.round(current?.transactions_per_sec ?? 0))}
              />
              <Delta
                parts={transactionsDelta}
                suffix={suffix}
                shortSuffix={shortSuffix}
              />
            </InfraTile>

            <InfraTile icon={Zap} label="Replication">
              <p className="m-0 flex min-h-[24px] items-center gap-2 sm:min-h-[26px] sm:gap-2.5">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full bg-[var(--projects-accent)]"
                />
                <span className="truncate text-[15px] font-bold leading-none text-[var(--projects-accent)] sm:text-[19px]">
                  Healthy
                </span>
              </p>
              <p className="m-0 truncate text-[12px] leading-4 text-[var(--projects-muted)]">
                {current && current.replication_standbys > 0
                  ? `${current.replication_standbys} standby${current.replication_standbys === 1 ? "" : "s"}`
                  : "Standalone instance"}
              </p>
            </InfraTile>

            {/* Wide size card: number + delta on the first row, sparkline
                directly under it on phones, side-by-side on sm+. */}
            <InfraTile
              icon={Database}
              label="Database Size"
              className="col-span-2 lg:col-span-2"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="admin-tnum m-0 flex flex-wrap items-baseline gap-2">
                    <span className="truncate text-[21px] font-bold leading-none tracking-[-0.02em] text-[var(--projects-text)] sm:text-[26px]">
                      {current ? formatBytes(current.database_size_bytes) : "—"}
                    </span>
                    <Delta
                      parts={sizeDelta}
                      suffix={suffix}
                      shortSuffix={shortSuffix}
                    />
                  </p>
                  <p className="m-0 truncate text-[12px] leading-4 text-[var(--projects-muted)]">
                    Primary database
                  </p>
                </div>
                <Sparkline
                  data={sizeHistory}
                  tone="accent"
                  height={40}
                  className="h-[40px] w-full sm:w-56 sm:max-w-56 sm:shrink-0"
                />
              </div>
            </InfraTile>
          </div>
        </div>
      )}
    </AdminPanel>
  );
}
