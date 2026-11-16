"use client";

import { useState } from "react";
import { Server } from "lucide-react";
import {
  useInfrastructureReadModel,
  type HostTimeRange,
} from "../data/admin-read-model";
import { AdminHeader, AdminPageBody } from "../components/admin-panel";
import { StatTile } from "../components/stat-tile";
import { LiveIndicator } from "../components/live-indicator";
import { HostTimeRangeSelect } from "../components/time-range-select";
import { PanelRowsSkeleton } from "../components/admin-skeletons";
import { ResourceCharts } from "./resource-charts";
import { HostList } from "./host-list";
import { WorkersSection } from "./workers-section";

/** Infrastructure — hosts, resources, workers, runtime health. */
export function InfrastructurePage() {
  const [range, setRange] = useState<HostTimeRange>("1h");
  const read = useInfrastructureReadModel(range);
  const { host, series, cpuHistory, operations } = read.data;
  const memoryUsed = host ? (host.memory / 100) * host.memoryTotalGb : 0;

  return (
    <AdminPageBody>
      <AdminHeader
        title="Infrastructure"
        subtitle="Monitor hosts, resources, workers, and runtime health."
      >
        <HostTimeRangeSelect value={range} onChange={setRange} />
        <LiveIndicator live={read.status !== "error"} />
      </AdminHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile icon={Server} label="Hosts" value={host ? "1" : "—"} />
        <StatTile
          label="Online"
          value={host?.status === "online" ? "1" : "0"}
          tone="success"
        />
        <StatTile label="CPU now" value={host ? `${host.cpu}%` : "—"} />
        <StatTile
          label="Memory"
          value={host ? `${memoryUsed.toFixed(1)} GB` : "—"}
          hint={host ? `/ ${host.memoryTotalGb} GB` : undefined}
        />
        <StatTile
          label="Storage"
          value={
            host
              ? `${Math.round((host.storage / 100) * host.storageTotalGb)} GB`
              : "—"
          }
          hint={host ? `/ ${host.storageTotalGb} GB` : undefined}
        />
      </div>

      {read.status === "pending" ? (
        <PanelRowsSkeleton rows={4} />
      ) : read.status === "error" ? (
        <p className="m-0 rounded-lg border border-[var(--projects-border)] bg-[#141416] px-4 py-8 text-center text-[13px] text-[var(--projects-danger)]">
          {read.error}
        </p>
      ) : (
        <>
          <ResourceCharts series={series} />

          <HostList host={host} cpuHistory={cpuHistory} />

          <WorkersSection operations={operations} />
        </>
      )}
    </AdminPageBody>
  );
}
