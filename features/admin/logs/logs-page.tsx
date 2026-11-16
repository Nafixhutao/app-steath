"use client";

import { useDeferredValue, useMemo, useState } from "react";
import {
  useLogsReadModel,
  type AdminTimeRange,
} from "../data/admin-read-model";
import { AdminHeader, AdminPageBody, Mono } from "../components/admin-panel";
import { AdminSelect } from "../components/admin-select";
import { TimeRangeSelect } from "../components/time-range-select";
import { LiveToggle, ToolbarSearch } from "../components/toolbar-search";
import { DetailDrawer, DetailField } from "../components/detail-drawer";
import { CopyButton } from "@/components/copy-button";
import { StatusBadge } from "../components/status-badge";
import { PanelRowsSkeleton } from "../components/admin-skeletons";
import { cn } from "@/lib/utils";
import type { LogEntry, LogLevel } from "../types/logs";

const LEVELS: LogLevel[] = ["INFO", "WARN", "ERROR", "DEBUG"];

const LEVEL_TONE: Record<LogLevel, { text: string; label: string }> = {
  INFO: { text: "text-[#a1a1aa]", label: "text-[#a1a1aa]" },
  WARN: {
    text: "text-[var(--projects-warning)]",
    label: "text-[var(--projects-warning)]",
  },
  ERROR: {
    text: "text-[var(--projects-danger)]",
    label: "text-[var(--projects-danger)]",
  },
  DEBUG: { text: "text-[#62626a]", label: "text-[#62626a]" },
};

type LevelFilter = "all" | LogLevel;
type ServiceFilter = "all" | string;

/**
 * Logs — the bounded telemetry explorer. The API owns filtering and the
 * optional SSE tail; this page only projects redacted records for display.
 */
export function LogsPage() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [range, setRange] = useState<AdminTimeRange>("1h");
  const [service, setService] = useState<ServiceFilter>("all");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [liveTail, setLiveTail] = useState(false);
  const [selected, setSelected] = useState<LogEntry | null>(null);

  const read = useLogsReadModel({
    range,
    service: service === "all" ? undefined : service,
    level: level === "all" ? undefined : level.toLowerCase(),
    search: deferredQuery.trim() || undefined,
    live: liveTail,
  });

  const services = useMemo(
    () => [...new Set(read.data.map((entry) => entry.service))].sort(),
    [read.data],
  );

  return (
    <AdminPageBody>
      <AdminHeader
        title="Logs"
        subtitle="Search, filter, and inspect platform logs across services."
      >
        <TimeRangeSelect value={range} onChange={setRange} />
      </AdminHeader>

      <div className="flex flex-wrap items-center gap-2.5">
        <ToolbarSearch
          value={query}
          onChange={setQuery}
          placeholder="Search logs..."
          label="Search logs"
        />
        <AdminSelect
          label="Filter by service"
          value={service}
          onChange={(value) => setService(value as ServiceFilter)}
          options={[
            { value: "all", label: "All services" },
            ...services.map((item) => ({ value: item, label: item })),
          ]}
        />
        <AdminSelect
          label="Filter by level"
          value={level}
          onChange={(value) => setLevel(value as LevelFilter)}
          options={[
            { value: "all", label: "All levels" },
            ...LEVELS.map((item) => ({ value: item, label: item })),
          ]}
        />
        <div className="ml-auto">
          <LiveToggle enabled={liveTail} onChange={setLiveTail} />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--projects-border)] bg-[#141416]">
        <div
          aria-hidden="true"
          className="hidden grid-cols-[92px_58px_84px_minmax(0,1fr)_auto] gap-3 border-b border-[var(--projects-divider)] px-3.5 py-2 md:grid"
        >
          <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--projects-muted)]">
            Time
          </span>
          <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--projects-muted)]">
            Level
          </span>
          <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--projects-muted)]">
            Service
          </span>
          <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--projects-muted)]">
            Message
          </span>
          <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--projects-muted)]">
            Meta
          </span>
        </div>
        <div
          className="admin-scrollbar max-h-[640px] overflow-y-auto"
          aria-label="Log stream"
        >
          {read.status === "pending" ? (
            <PanelRowsSkeleton rows={8} />
          ) : read.status === "error" ? (
            <p className="m-0 px-4 py-12 text-center text-[13px] text-[var(--projects-danger)]">
              {read.error}
            </p>
          ) : read.data.length === 0 ? (
            <p className="m-0 px-4 py-12 text-center text-[13px] text-[var(--projects-muted)]">
              No log entries match the current filters.
            </p>
          ) : (
            read.data.map((entry) => (
              <LogRow
                key={entry.id}
                entry={entry}
                onOpen={() => setSelected(entry)}
              />
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-[var(--projects-divider)] px-3.5 py-2">
          <Mono className="text-[11px] text-[var(--projects-muted)]">
            {read.data.length} entries
          </Mono>
          <Mono className="text-[11px] text-[var(--projects-muted)]">
            {liveTail ? "live tail" : `window ${range}`}
          </Mono>
        </div>
      </div>

      <LogDetail entry={selected} onClose={() => setSelected(null)} />
    </AdminPageBody>
  );
}

function LogRow({ entry, onOpen }: { entry: LogEntry; onOpen: () => void }) {
  const tone = LEVEL_TONE[entry.level];
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Inspect log: ${entry.message}`}
      className="stealth-log-line block w-full border-b border-[var(--projects-divider)] px-3.5 py-1.5 text-left transition-colors last:border-b-0 hover:bg-white/[0.03] aria-selected:bg-white/[0.04]"
    >
      <span className="hidden items-baseline gap-3 md:grid md:grid-cols-[92px_58px_84px_minmax(0,1fr)_auto]">
        <Mono className="text-[11.5px] leading-5 text-[#8a8791]">
          {entry.timestamp}
        </Mono>
        <span
          className={cn(
            "text-[11px] font-semibold leading-5 tracking-wide",
            tone.text,
          )}
        >
          {entry.level}
        </span>
        <Mono className="truncate text-[11.5px] leading-5 text-[#b3b0ba]">
          {entry.service}
        </Mono>
        <span className="min-w-0">
          <Mono className="block truncate text-[12px] leading-5 text-[var(--projects-text)]">
            {entry.message}
          </Mono>
        </span>
        <Mono className="text-[11.5px] leading-5 text-[#8a8791]">
          {entry.meta}
        </Mono>
      </span>
      <span className="block md:hidden">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-[10.5px] font-semibold tracking-wide",
              tone.text,
            )}
          >
            {entry.level}
          </span>
          <Mono className="truncate text-[11.5px] leading-5 text-[#b3b0ba]">
            {entry.service}
          </Mono>
          <Mono className="ml-auto shrink-0 text-[10.5px] leading-5 text-[#8a8791]">
            {entry.timestamp}
          </Mono>
        </span>
        <Mono className="mt-0.5 block break-words text-[12px] leading-4 text-[var(--projects-text)]">
          {entry.message}
        </Mono>
      </span>
    </button>
  );
}

function LogDetail({
  entry,
  onClose,
}: {
  entry: LogEntry | null;
  onClose: () => void;
}) {
  return (
    <DetailDrawer
      open={entry !== null}
      onClose={onClose}
      title={
        <>
          <span className="truncate">Log detail</span>
          {entry && (
            <StatusBadge
              tone="neutral"
              label={entry.service}
              className="ml-2"
            />
          )}
        </>
      }
      subtitle={entry?.message}
    >
      {entry && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-x-4">
            <DetailField label="Timestamp">
              <span className="admin-mono flex items-center gap-1">
                {entry.timestamp}
                <CopyButton text={entry.timestamp} />
              </span>
            </DetailField>
            <DetailField label="Level">
              <span
                className={cn(
                  "text-[12px] font-semibold",
                  LEVEL_TONE[entry.level].label,
                )}
              >
                {entry.level}
              </span>
            </DetailField>
            <DetailField label="Service">{entry.service}</DetailField>
            <DetailField label="Environment">{entry.environment}</DetailField>
            <DetailField label="Request ID">
              <span className="admin-mono flex items-center gap-1">
                {entry.requestId}
                <CopyButton text={entry.requestId} />
              </span>
            </DetailField>
            <DetailField label="Trace ID">
              <span className="admin-mono flex items-center gap-1">
                {entry.traceId}
                <CopyButton text={entry.traceId} />
              </span>
            </DetailField>
            <DetailField label="User">{entry.user ?? "—"}</DetailField>
            <DetailField label="Agent Run">{entry.agentRun ?? "—"}</DetailField>
          </div>

          <div>
            <p className="m-0 mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--projects-muted)]">
              Attributes
            </p>
            <pre className="admin-scrollbar m-0 overflow-x-auto rounded-lg border border-[var(--projects-border)] bg-[#0f0f11] p-3 text-[11.5px] leading-5 text-[#c9c5cd]">
              {JSON.stringify(entry.attributes, null, 2)}
            </pre>
            <div className="mt-2 flex justify-end">
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--projects-muted)]">
                Copy JSON
                <CopyButton text={JSON.stringify(entry.attributes, null, 2)} />
              </span>
            </div>
          </div>
        </div>
      )}
    </DetailDrawer>
  );
}
