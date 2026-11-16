"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRunsReadModel, type RunProjection } from "../data/admin-read-model";
import { AdminHeader, AdminPageBody, Mono } from "../components/admin-panel";
import { ToolbarSearch } from "../components/toolbar-search";
import { AdminSelect } from "../components/admin-select";
import { DetailDrawer, DetailField } from "../components/detail-drawer";
import { RunStatusBadge } from "../components/domain-badges";
import { PanelRowsSkeleton } from "../components/admin-skeletons";
import { formatDuration } from "../lib/format";

type StatusFilter = "all" | RunProjection["status"];

/**
 * Agent Runs — durable agent-run operations from the instance Admin API.
 * Token, cost, provider, and model fields are absent because this endpoint
 * does not publish them.
 */
export function RunsPage() {
  const read = useRunsReadModel("7d");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<RunProjection | null>(null);

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return read.data.filter((run) => {
      if (status !== "all" && run.status !== status) return false;
      if (!normalizedQuery) return true;
      return [run.id, run.agent, run.project]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [query, read.data, status]);

  return (
    <AdminPageBody>
      <AdminHeader
        title="Agent Runs"
        subtitle="Durable agent runs across every project for the last seven days."
      >
        <Mono className="hidden h-9 items-center rounded-lg border border-[var(--projects-border)] bg-[#141416] px-3 text-[12px] text-[var(--projects-muted)] sm:inline-flex">
          {visible.length} / {read.data.length} runs
        </Mono>
      </AdminHeader>

      <div className="flex flex-wrap items-center gap-2.5">
        <ToolbarSearch
          value={query}
          onChange={setQuery}
          placeholder="Search run, agent, project..."
          label="Search runs"
        />
        <AdminSelect
          label="Filter by status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "All statuses" },
            { value: "queued", label: "Queued" },
            { value: "running", label: "Running" },
            { value: "completed", label: "Completed" },
            { value: "failed", label: "Failed" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--projects-border)] bg-[#141416]">
        <div
          aria-hidden="true"
          className="hidden grid-cols-[110px_minmax(0,1.4fr)_minmax(0,1fr)_100px_110px_100px] gap-3 border-b border-[var(--projects-divider)] px-3.5 py-2 lg:grid"
        >
          <ColumnLabel>Run</ColumnLabel>
          <ColumnLabel>Agent</ColumnLabel>
          <ColumnLabel>Project</ColumnLabel>
          <ColumnLabel>Duration</ColumnLabel>
          <ColumnLabel>Status</ColumnLabel>
          <ColumnLabel>Started</ColumnLabel>
        </div>
        {read.status === "pending" ? (
          <PanelRowsSkeleton rows={8} />
        ) : read.status === "error" ? (
          <p className="m-0 px-4 py-12 text-center text-[13px] text-[var(--projects-danger)]">
            {read.error}
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {visible.length === 0 ? (
              <li className="px-4 py-12 text-center text-[13px] text-[var(--projects-muted)]">
                No runs match the current filters.
              </li>
            ) : (
              visible.map((run) => (
                <li
                  key={run.id}
                  className="border-b border-[var(--projects-divider)] last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => setSelected(run)}
                    aria-label={`Inspect run ${run.id}`}
                    className="block w-full px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
                  >
                    <span className="hidden items-center gap-3 lg:grid lg:grid-cols-[110px_minmax(0,1.4fr)_minmax(0,1fr)_100px_110px_100px]">
                      <Mono className="truncate text-[11.5px] font-medium text-[var(--projects-text)]">
                        {run.id.slice(0, 8)}
                      </Mono>
                      <span className="truncate text-[12.5px] text-[var(--projects-text)]">
                        {run.agent}
                      </span>
                      <span className="truncate text-[12px] text-[var(--projects-muted)]">
                        {run.project}
                      </span>
                      <Mono className="text-[11.5px] text-[var(--projects-muted)]">
                        {run.durationMs > 0
                          ? formatDuration(run.durationMs)
                          : "—"}
                      </Mono>
                      <RunStatusBadge status={run.status} />
                      <Mono className="text-[11px] text-[var(--projects-muted)]">
                        {run.startedAt}
                      </Mono>
                    </span>
                    <span className="block lg:hidden">
                      <span className="flex items-center gap-2">
                        <Mono className="text-[12px] font-medium text-[var(--projects-text)]">
                          {run.id.slice(0, 8)}
                        </Mono>
                        <span className="truncate text-[12px] text-[var(--projects-muted)]">
                          {run.agent}
                        </span>
                        <span className="ml-auto shrink-0">
                          <RunStatusBadge status={run.status} />
                        </span>
                      </span>
                      <Mono className="mt-1 block text-[11px] leading-4 text-[var(--projects-muted)]">
                        {run.project} ·{" "}
                        {run.durationMs > 0
                          ? formatDuration(run.durationMs)
                          : "pending"}{" "}
                        · {run.startedAt}
                      </Mono>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      <RunDetail run={selected} onClose={() => setSelected(null)} />
    </AdminPageBody>
  );
}

function RunDetail({
  run,
  onClose,
}: {
  run: RunProjection | null;
  onClose: () => void;
}) {
  return (
    <DetailDrawer
      open={run !== null}
      onClose={onClose}
      title={
        <>
          <Mono className="truncate">{run?.id}</Mono>
          {run && (
            <span className="ml-2">
              <RunStatusBadge status={run.status} />
            </span>
          )}
        </>
      }
      subtitle={run ? `${run.agent} · ${run.project}` : undefined}
    >
      {run && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-x-4">
            <DetailField label="Agent">{run.agent}</DetailField>
            <DetailField label="Project">{run.project}</DetailField>
            <DetailField label="Duration">
              {run.durationMs > 0 ? formatDuration(run.durationMs) : "—"}
            </DetailField>
            <DetailField label="Started">{run.startedAt}</DetailField>
            <DetailField label="Run ID" wide>
              <Mono>{run.id}</Mono>
            </DetailField>
          </div>

          {run.error && (
            <div>
              <p className="m-0 mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--projects-muted)]">
                Error
              </p>
              <p className="m-0 rounded-lg border border-[color-mix(in_srgb,var(--projects-danger)_45%,var(--projects-border))] bg-[color-mix(in_srgb,var(--projects-danger)_8%,#0f0f11)] p-3 text-[12.5px] leading-5 text-[var(--projects-danger)]">
                {run.error}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/logs"
              className="inline-flex h-8 items-center rounded-md border border-[var(--projects-border)] px-3 text-[12px] font-medium text-[var(--projects-text)] transition-colors hover:border-[var(--projects-border-hover)] hover:bg-white/[0.04]"
            >
              View Logs
            </Link>
            <Link
              href="/admin/traces"
              className="inline-flex h-8 items-center rounded-md border border-[var(--projects-border)] px-3 text-[12px] font-medium text-[var(--projects-text)] transition-colors hover:border-[var(--projects-border-hover)] hover:bg-white/[0.04]"
            >
              View Traces
            </Link>
          </div>
        </div>
      )}
    </DetailDrawer>
  );
}

function ColumnLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--projects-muted)]">
      {children}
    </span>
  );
}
