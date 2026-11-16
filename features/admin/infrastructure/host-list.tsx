"use client";

import { useState } from "react";
import { Cpu, HardDrive, MemoryStick } from "lucide-react";
import { AdminPanel, AdminPanelHeader, Mono } from "../components/admin-panel";
import { ResourceBar } from "../components/resource-bar";
import { Sparkline } from "../components/sparkline";
import { StatusBadge } from "../components/status-badge";
import type { Host } from "../types/infrastructure";

/**
 * Host inventory rows with per-resource bars. Selecting a host expands a
 * detail strip (ip/region/uptime/jobs + CPU history) beneath the list.
 */
export function HostList({
  host,
  cpuHistory,
}: {
  host: Host | null;
  cpuHistory: number[];
}) {
  const [selected, setSelected] = useState(true);

  return (
    <AdminPanel>
      <AdminPanelHeader
        title="Hosts"
        subtitle="Select a host for runtime details. Bars show current load per resource."
      />
      {!host ? (
        <p className="m-0 px-1 py-8 text-center text-[13px] text-[var(--projects-muted)]">
          Host metrics are unavailable.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          <HostRow
            key={host.id}
            host={host}
            selected={selected}
            onSelect={() => setSelected((current) => !current)}
          />
        </ul>
      )}
      {selected && host && <HostDetail host={host} cpuHistory={cpuHistory} />}
    </AdminPanel>
  );
}

function HostRow({
  host,
  selected,
  onSelect,
}: {
  host: Host;
  selected: boolean;
  onSelect: () => void;
}) {
  const memoryUsedGb = (host.memory / 100) * host.memoryTotalGb;
  const storageUsedGb = (host.storage / 100) * host.storageTotalGb;

  return (
    <li className="border-b border-[var(--projects-divider)] last:border-b-0">
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={selected}
        className="block w-full px-3 py-3 text-left transition-colors hover:bg-white/[0.02] aria-expanded:bg-white/[0.03]"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Mono className="text-[13px] font-medium leading-5 text-[var(--projects-text)]">
            {host.name}
          </Mono>
          <StatusBadge
            tone={
              host.status === "online"
                ? "success"
                : host.status === "maintenance"
                  ? "warning"
                  : "danger"
            }
            label={
              host.status === "online"
                ? "Online"
                : host.status === "maintenance"
                  ? "Maintenance"
                  : "Offline"
            }
            pulse={host.status === "online"}
          />
          <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--projects-muted)]">
            <span>{host.os}</span>
            <span aria-hidden="true" className="hidden sm:inline">
              ·
            </span>
            <span className="hidden sm:inline">uptime {host.uptime}</span>
            <span aria-hidden="true">·</span>
            <span>{host.workers} workers</span>
          </span>
        </div>
        <div className="mt-2.5 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3">
          <ResourceBar label="CPU" value={host.cpu} />
          <ResourceBar
            label="Memory"
            value={host.memory}
            detail={`${memoryUsedGb.toFixed(1)} / ${host.memoryTotalGb} GB`}
          />
          <ResourceBar
            label="Storage"
            value={host.storage}
            detail={`${Math.round(storageUsedGb)} / ${host.storageTotalGb} GB`}
          />
        </div>
      </button>
    </li>
  );
}

function HostDetail({
  host,
  cpuHistory,
}: {
  host: Host;
  cpuHistory: number[];
}) {
  return (
    <div className="border-t border-[var(--projects-divider)] bg-white/[0.02] px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Mono className="text-[12px] font-medium text-[var(--projects-text)]">
          {host.name}
        </Mono>
        <Mono className="text-[11.5px] text-[var(--projects-muted)]">
          {host.ip}
        </Mono>
        <Mono className="text-[11.5px] text-[var(--projects-muted)]">
          {host.region}
        </Mono>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Detail icon={Cpu} label="CPU now" value={`${host.cpu}%`} />
        <Detail
          icon={MemoryStick}
          label="Memory"
          value={`${Math.round((host.memory / 100) * host.memoryTotalGb * 10) / 10} / ${host.memoryTotalGb} GB`}
        />
        <Detail
          icon={HardDrive}
          label="Storage"
          value={`${Math.round((host.storage / 100) * host.storageTotalGb)} / ${host.storageTotalGb} GB`}
        />
        <Detail label="Active jobs" value={String(host.jobs)} />
      </dl>
      {cpuHistory.length > 0 && (
        <div className="mt-3">
          <p className="m-0 mb-1 text-[10.5px] font-medium uppercase tracking-[0.07em] text-[var(--projects-muted)]">
            CPU · last 30 min
          </p>
          <Sparkline data={cpuHistory} tone="accent" height={36} />
        </div>
      )}
    </div>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon?: typeof Cpu;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {Icon && (
        <Icon
          size={14}
          strokeWidth={1.8}
          className="shrink-0 text-[var(--projects-muted)]"
          aria-hidden="true"
        />
      )}
      <div className="min-w-0">
        <dt className="m-0 truncate text-[10.5px] uppercase tracking-[0.06em] text-[var(--projects-muted)]">
          {label}
        </dt>
        <dd className="m-0 truncate text-[12.5px] font-medium text-[var(--projects-text)]">
          {value}
        </dd>
      </div>
    </div>
  );
}
