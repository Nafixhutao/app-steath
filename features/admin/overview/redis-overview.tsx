"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Activity, Clock, Database, Gauge, Users, Zap } from "lucide-react";
import { useAdminRedisMetrics } from "@/features/admin/data/admin-read-model";
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
 * Admin Overview Redis panel: clients, throughput, hit rate, memory, keys,
 * and uptime — every number from Redis's own INFO payload through the API's
 * in-process sampler. Standalone values are never invented for a missing cap
 * or a fresh instance with no reads yet.
 */
export function RedisOverview({ windowMinutes }: { windowMinutes: number }) {
  const query = useAdminRedisMetrics(windowMinutes);
  const snapshot = query.data;
  const current = snapshot?.current;
  const history = useMemo(() => snapshot?.history ?? [], [snapshot]);

  // The sampler answers in milliseconds, so hold the skeleton for a short
  // minimum window on first load only; errors dismiss it immediately.
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

  const clientPercent =
    current && current.max_clients > 0
      ? (current.connections / current.max_clients) * 100
      : 0;
  const memoryPercent =
    current && current.memory_max_bytes > 0
      ? (current.memory_used_bytes / current.memory_max_bytes) * 100
      : 0;

  const opsHistory = useMemo(
    () => history.map((sample) => sample.ops_per_sec),
    [history],
  );
  const suffix = windowSuffix(windowMinutes);
  const shortSuffix = windowSuffixShort(windowMinutes);
  const opsDelta = useMemo(() => {
    if (history.length < 2) return undefined;
    return deltaParts(
      history[history.length - 1].ops_per_sec,
      history[0].ops_per_sec,
      true,
    );
  }, [history]);

  return (
    <AdminPanel className="p-3 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 pb-3.5 sm:pb-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl sm:size-14"
          >
            <Image
              src="/redis.svg"
              alt=""
              width={34}
              height={34}
              unoptimized
              className="size-[26px] object-contain sm:size-[34px]"
            />
          </span>
          <div className="min-w-0">
            <h2 className="m-0 truncate text-[16px] font-bold leading-5 tracking-[-0.01em] text-[var(--projects-text)] sm:text-[19px] sm:leading-6">
              Cache (Redis)
            </h2>
            <p className="m-0 mt-0.5 truncate text-[12px] leading-4 text-[var(--projects-muted)] sm:mt-1 sm:text-[13px]">
              Shared cache & queues
              {snapshot?.server_version
                ? ` • ${versionLabel(snapshot.server_version, "Redis")}`
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
        <InfraPanelSkeleton count={4} />
      ) : !reachable ? (
        <p className="m-0 pb-2 text-[13px] leading-5 text-[var(--projects-muted)]">
          Redis metrics are unavailable right now. The sampler could not reach
          the server; the panel recovers automatically once commands succeed
          again.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <InfraTile icon={Users} label="Clients">
            <TileValue
              value={String(current?.connections ?? 0)}
              unit={
                current && current.max_clients > 0
                  ? `/ ${current.max_clients}`
                  : undefined
              }
            />
            {current && current.max_clients > 0 ? (
              <TileBar percent={clientPercent} />
            ) : null}
            <p className="m-0 truncate text-[12px] leading-4 text-[var(--projects-muted)]">
              Connected clients
            </p>
          </InfraTile>

          <InfraTile icon={Activity} label="Ops/sec">
            <TileValue value={String(Math.round(current?.ops_per_sec ?? 0))} />
            <Delta parts={opsDelta} suffix={suffix} shortSuffix={shortSuffix} />
          </InfraTile>

          <InfraTile icon={Gauge} label="Hit Rate">
            <TileValue
              value={
                current?.hit_rate_known
                  ? current.hit_rate_percent.toFixed(1)
                  : "—"
              }
              unit={current?.hit_rate_known ? "%" : undefined}
            />
            {current?.hit_rate_known ? (
              <TileBar percent={current.hit_rate_percent} higherIsBetter />
            ) : (
              <p className="m-0 text-[12px] leading-4 text-[var(--projects-muted)]">
                No reads recorded yet
              </p>
            )}
          </InfraTile>

          <InfraTile icon={Zap} label="Keys">
            <TileValue value={String(current?.keys ?? 0)} />
            <p className="m-0 truncate text-[12px] leading-4 text-[var(--projects-muted)]">
              Across all logical DBs
            </p>
          </InfraTile>

          {/* Wide memory card, full row on desktop. */}
          <InfraTile
            icon={Database}
            label="Memory"
            className="col-span-2 lg:col-span-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div className="flex min-w-0 flex-col gap-1.5">
                <TileValue
                  value={current ? formatBytes(current.memory_used_bytes) : "—"}
                  unit={
                    current && current.memory_max_bytes > 0
                      ? `of ${formatBytes(current.memory_max_bytes)}`
                      : undefined
                  }
                />
                {current && current.memory_max_bytes > 0 ? (
                  <TileBar percent={memoryPercent} />
                ) : (
                  <p className="m-0 text-[12px] leading-4 text-[var(--projects-muted)]">
                    No maxmemory cap configured
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Sparkline
                  data={opsHistory}
                  tone="warning"
                  height={36}
                  className="h-[36px] w-28 sm:w-44"
                />
                <div className="flex items-center gap-2 text-[var(--projects-muted)]">
                  <Clock size={13} aria-hidden="true" />
                  <span className="text-[12px]">
                    {current && current.uptime_seconds > 0
                      ? `up ${uptimeLabel(current.uptime_seconds)}`
                      : "in-process sampler"}
                  </span>
                </div>
              </div>
            </div>
          </InfraTile>
        </div>
      )}
    </AdminPanel>
  );
}
