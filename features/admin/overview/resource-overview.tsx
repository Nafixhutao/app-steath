"use client";

import { useMemo } from "react";
import { AdminPanel } from "../components/admin-panel";
import { TelemetryChart, ChartTabs } from "../components/telemetry-chart";
import type { MetricPoint } from "../types/telemetry";

export type OverviewTab = "cpu" | "memory" | "network";

const TAB_META: Record<
  OverviewTab,
  {
    label: string;
    unit: string;
    tone: "accent" | "info" | "warning";
    hint: string;
  }
> = {
  cpu: {
    label: "CPU",
    unit: "%",
    tone: "accent",
    hint: "Host CPU across all cores",
  },
  memory: {
    label: "Memory",
    unit: " GB",
    tone: "info",
    hint: "Host resident memory",
  },
  network: {
    label: "Network",
    unit: " KB/s",
    tone: "warning",
    hint: "Host receive rate",
  },
};

const TAB_OPTIONS = [
  { value: "cpu" as const, label: "CPU" },
  { value: "memory" as const, label: "Memory" },
  { value: "network" as const, label: "Network" },
];

/** The big resource usage chart with CPU / Memory / Network tabs. */
export function ResourceOverview({
  series,
  tab,
  onTabChange,
  rangeLabel,
  className,
}: {
  series: Record<OverviewTab, MetricPoint[]>;
  tab: OverviewTab;
  onTabChange: (tab: OverviewTab) => void;
  rangeLabel: string;
  className?: string;
}) {
  const meta = TAB_META[tab];
  const data = series[tab];

  const subtitle = useMemo(
    () => `${meta.hint} · ${rangeLabel}`,
    [meta.hint, rangeLabel],
  );

  return (
    <AdminPanel className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-3 pt-1">
        <div>
          <h2 className="m-0 text-[14px] font-semibold leading-5 text-[var(--projects-text)]">
            Resource Usage
          </h2>
          <p className="m-0 mt-0.5 text-[12px] leading-4 text-[var(--projects-muted)]">
            {subtitle}
          </p>
        </div>
        <ChartTabs
          value={tab}
          options={TAB_OPTIONS}
          onChange={onTabChange}
          ariaLabel="Resource metric"
        />
      </div>
      <TelemetryChart
        data={data}
        series={[{ key: "value", label: meta.label, tone: meta.tone }]}
        unit={meta.unit}
        height={252}
      />
    </AdminPanel>
  );
}
