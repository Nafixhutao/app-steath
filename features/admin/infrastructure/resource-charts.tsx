"use client";

import { AdminPanel } from "../components/admin-panel";
import { TelemetryChart } from "../components/telemetry-chart";
import { Mono } from "../components/admin-panel";
import type { ResourceSeries } from "../types/infrastructure";

/**
 * The 2-column (1 on mobile) grid of CPU / Memory / Disk / Network charts.
 */
export function ResourceCharts({ series }: { series: ResourceSeries[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {series.map((item) => (
        <AdminPanel key={item.id}>
          <div className="flex flex-wrap items-start justify-between gap-2 px-1 pb-2 pt-1">
            <div>
              <h3 className="m-0 text-[13.5px] font-semibold leading-5 text-[var(--projects-text)]">
                {item.label}
              </h3>
              <Mono className="m-0 mt-0.5 block text-[11px] leading-4 text-[var(--projects-muted)]">
                peak {item.peak} · avg {item.average}
              </Mono>
            </div>
            <Mono className="text-[19px] font-semibold leading-6 tracking-[-0.01em] text-[var(--projects-text)]">
              {item.current}
            </Mono>
          </div>
          <TelemetryChart
            data={item.data}
            series={[{ key: "value", label: item.label, tone: item.tone }]}
            unit={item.unit}
            height={148}
          />
        </AdminPanel>
      ))}
    </div>
  );
}
