"use client";

import { useState, type ReactNode } from "react";
import {
  useUsageReadModel,
  type AdminTimeRange,
} from "../data/admin-read-model";
import { AdminHeader, AdminPageBody, Mono } from "../components/admin-panel";
import { AdminPanel, AdminPanelHeader } from "../components/admin-panel";
import { StatTile } from "../components/stat-tile";
import { TimeRangeSelect } from "../components/time-range-select";
import { PanelRowsSkeleton } from "../components/admin-skeletons";
import { StatusBadge } from "../components/status-badge";
import { formatDuration } from "../lib/format";

function kindLabel(kind: string): string {
  return kind.replaceAll("_", " ");
}

/**
 * Usage — durable control-plane workload for the selected window. Stealth does
 * not expose token, spend, or model-usage totals on this Admin API, so those
 * earlier fixture values are not rendered.
 */
export function UsagePage() {
  const [range, setRange] = useState<AdminTimeRange>("7d");
  const read = useUsageReadModel(range);
  const { summary, totalRecent, byKind, byStatus, recent } = read.data;

  return (
    <AdminPageBody>
      <AdminHeader
        title="Usage"
        subtitle="Durable control-plane workload across deployments, executions, and jobs."
      >
        <TimeRangeSelect value={range} onChange={setRange} />
      </AdminHeader>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          label="Recent operations"
          value={String(totalRecent)}
          hint="bounded API window"
        />
        <StatTile
          label="Queued now"
          value={String(summary?.queued_jobs ?? 0)}
          tone={(summary?.queued_jobs ?? 0) > 0 ? "warning" : "neutral"}
        />
        <StatTile
          label="Running now"
          value={String(summary?.running_jobs ?? 0)}
          tone="success"
        />
        <StatTile
          label="Active deployments"
          value={String(summary?.active_deployments ?? 0)}
        />
      </div>

      {read.status === "pending" ? (
        <PanelRowsSkeleton rows={6} />
      ) : read.status === "error" ? (
        <p className="m-0 rounded-lg border border-[var(--projects-border)] bg-[#141416] px-4 py-8 text-center text-[13px] text-[var(--projects-danger)]">
          {read.error}
        </p>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <AdminPanel>
              <AdminPanelHeader
                title="By operation kind"
                subtitle={`${totalRecent} newest operations in the selected window.`}
              />
              <BreakdownList
                rows={byKind.map((item) => ({
                  label: kindLabel(item.kind),
                  value: item.count,
                }))}
              />
            </AdminPanel>
            <AdminPanel>
              <AdminPanelHeader
                title="By status"
                subtitle="Current status of the same bounded operation set."
              />
              <BreakdownList
                rows={byStatus.map((item) => ({
                  label: item.status,
                  value: item.count,
                }))}
              />
            </AdminPanel>
          </div>

          <AdminPanel flush>
            <div className="px-4 pb-3 pt-4">
              <AdminPanelHeader
                title="Recent operations"
                subtitle="Newest first; this table is a bounded sample, not a billing ledger."
              />
            </div>
            <div className="admin-scrollbar overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-left">
                <thead>
                  <tr className="border-y border-[var(--projects-divider)] bg-[var(--projects-control)]">
                    <Th>Operation</Th>
                    <Th>Kind</Th>
                    <Th>Project</Th>
                    <Th>Status</Th>
                    <Th>Duration</Th>
                    <Th>Created</Th>
                  </tr>
                </thead>
                <tbody>
                  {recent.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-10 text-center text-[13px] text-[var(--projects-muted)]"
                      >
                        No operations were recorded in this window.
                      </td>
                    </tr>
                  ) : (
                    recent.map((operation) => (
                      <tr
                        key={operation.id}
                        className="border-b border-[var(--projects-divider)] last:border-b-0 hover:bg-white/[0.02]"
                      >
                        <Td>
                          <Mono className="text-[12px] font-medium text-[var(--projects-text)]">
                            {operation.name}
                          </Mono>
                        </Td>
                        <Td>
                          <span className="text-[12px] text-[var(--projects-muted)]">
                            {kindLabel(operation.kind)}
                          </span>
                        </Td>
                        <Td>
                          <span className="text-[12px] text-[var(--projects-muted)]">
                            {operation.project_name ?? "—"}
                          </span>
                        </Td>
                        <Td>
                          <StatusBadge
                            tone={
                              operation.status.includes("fail")
                                ? "danger"
                                : operation.status.includes("run") ||
                                    operation.status.includes("build")
                                  ? "warning"
                                  : "neutral"
                            }
                            label={operation.status}
                          />
                        </Td>
                        <Td>
                          <Mono className="text-[11.5px] text-[var(--projects-muted)]">
                            {operation.duration_ms > 0
                              ? formatDuration(operation.duration_ms)
                              : "—"}
                          </Mono>
                        </Td>
                        <Td>
                          <Mono className="text-[11px] text-[var(--projects-muted)]">
                            {new Date(operation.created_at)
                              .toISOString()
                              .slice(0, 16)}
                          </Mono>
                        </Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </AdminPanel>
        </>
      )}
    </AdminPageBody>
  );
}

function BreakdownList({
  rows,
}: {
  rows: Array<{ label: string; value: number }>;
}) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <ul className="m-0 list-none p-0">
      {rows.length === 0 ? (
        <li className="py-6 text-center text-[12.5px] text-[var(--projects-muted)]">
          No operations observed.
        </li>
      ) : (
        rows.map((row) => (
          <li
            key={row.label}
            className="border-b border-[var(--projects-divider)] py-2.5 last:border-b-0"
          >
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--projects-text)]">
                {row.label}
              </span>
              <Mono className="text-[11.5px] text-[var(--projects-muted)]">
                {row.value}
              </Mono>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.05]">
              <span
                className="block h-full rounded-full bg-[var(--projects-accent)]"
                style={{
                  width: `${total > 0 ? (row.value / total) * 100 : 0}%`,
                }}
              />
            </div>
          </li>
        ))
      )}
    </ul>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th
      scope="col"
      className="px-3.5 py-2 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--projects-muted)]"
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: ReactNode }) {
  return <td className="px-3.5 py-2.5">{children}</td>;
}
