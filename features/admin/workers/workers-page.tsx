"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  useExecutionQueueReadModel,
  type AdminOperation,
} from "../data/admin-read-model";
import { AdminHeader, AdminPageBody, Mono } from "../components/admin-panel";
import { AdminPanel, AdminPanelHeader } from "../components/admin-panel";
import { DetailDrawer, DetailField } from "../components/detail-drawer";
import { PanelRowsSkeleton } from "../components/admin-skeletons";
import { StatusBadge } from "../components/status-badge";
import { formatDuration } from "../lib/format";

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("fail")) return "danger" as const;
  if (normalized.includes("run") || normalized.includes("build"))
    return "warning" as const;
  if (normalized.includes("complete") || normalized.includes("succeed"))
    return "success" as const;
  return "neutral" as const;
}

function operationKindLabel(kind: string): string {
  return kind.replaceAll("_", " ");
}

/**
 * Execution Queue — the durable work the control plane can expose. Stealth
 * does not publish worker identities, so this view never invents fleet rows.
 */
export function WorkersPage() {
  const read = useExecutionQueueReadModel();
  const [selected, setSelected] = useState<AdminOperation | null>(null);
  const { items, summary, queued, running, failed } = read.data;

  const kinds = useMemo(
    () => [...new Set(items.map((item) => item.kind))].sort(),
    [items],
  );

  return (
    <AdminPageBody>
      <AdminHeader
        title="Execution Queue"
        subtitle="Durable jobs waiting for trusted workers across the instance."
      >
        <Mono className="hidden h-9 items-center rounded-lg border border-[var(--projects-border)] bg-[#141416] px-3 text-[12px] text-[var(--projects-muted)] sm:inline-flex">
          last 24 hours
        </Mono>
      </AdminHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Queued" value={queued} tone="neutral" />
        <Tile label="Running" value={running} tone="success" />
        <Tile
          label="Failed"
          value={failed}
          tone={failed > 0 ? "warning" : "neutral"}
        />
        <Tile
          label="Active deployments"
          value={summary?.active_deployments ?? 0}
        />
      </div>

      <AdminPanel flush>
        <div className="px-3.5 pb-3 pt-4">
          <AdminPanelHeader
            title="Queue"
            subtitle="Newest durable operations first. Select one for its safe metadata."
            right={
              <Mono className="text-[11.5px] text-[var(--projects-muted)]">
                {items.length} records
              </Mono>
            }
          />
        </div>
        <div
          aria-hidden="true"
          className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_100px_110px_90px] gap-3 border-b border-[var(--projects-divider)] px-3.5 pb-2 lg:grid"
        >
          <Column>Operation</Column>
          <Column>Kind</Column>
          <Column>Project</Column>
          <Column>Duration</Column>
          <Column>Status</Column>
          <Column>Created</Column>
        </div>
        {read.status === "pending" ? (
          <PanelRowsSkeleton rows={8} />
        ) : read.status === "error" ? (
          <p className="m-0 px-4 py-12 text-center text-[13px] text-[var(--projects-danger)]">
            {read.error}
          </p>
        ) : items.length === 0 ? (
          <p className="m-0 px-4 py-12 text-center text-[13px] text-[var(--projects-muted)]">
            No durable operations were recorded in the last 24 hours.
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {items.map((item) => (
              <li
                key={item.id}
                className="border-b border-[var(--projects-divider)] last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => setSelected(item)}
                  aria-label={`Inspect ${item.kind} ${item.name}`}
                  className="block w-full px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
                >
                  <span className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_100px_110px_90px] lg:items-center lg:gap-3">
                    <Mono className="truncate text-[12.5px] font-medium text-[var(--projects-text)]">
                      {item.name}
                    </Mono>
                    <span className="truncate text-[12px] text-[var(--projects-muted)]">
                      {operationKindLabel(item.kind)}
                    </span>
                    <span className="truncate text-[12px] text-[var(--projects-muted)]">
                      {item.project_name ?? "—"}
                    </span>
                    <Mono className="text-[11.5px] text-[var(--projects-muted)]">
                      {item.duration_ms > 0
                        ? formatDuration(item.duration_ms)
                        : "—"}
                    </Mono>
                    <span>
                      <StatusBadge
                        tone={statusTone(item.status)}
                        label={item.status}
                      />
                    </span>
                    <Mono className="text-[11px] text-[var(--projects-muted)]">
                      {new Date(item.created_at).toISOString().slice(5, 16)}
                    </Mono>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </AdminPanel>

      <AdminPanel>
        <AdminPanelHeader
          title="Observed kinds"
          subtitle="Kinds present in the current 24-hour operation window."
        />
        <div className="flex flex-wrap gap-2">
          {kinds.length === 0 ? (
            <span className="text-[12px] text-[var(--projects-muted)]">
              No operation kinds observed.
            </span>
          ) : (
            kinds.map((kind) => (
              <Mono
                key={kind}
                className="rounded-md border border-[var(--projects-border)] px-2 py-1 text-[11px] text-[var(--projects-muted)]"
              >
                {operationKindLabel(kind)}
              </Mono>
            ))
          )}
        </div>
      </AdminPanel>

      <OperationDetail operation={selected} onClose={() => setSelected(null)} />
    </AdminPageBody>
  );
}

function OperationDetail({
  operation,
  onClose,
}: {
  operation: AdminOperation | null;
  onClose: () => void;
}) {
  return (
    <DetailDrawer
      open={operation !== null}
      onClose={onClose}
      title={<Mono className="truncate">{operation?.name}</Mono>}
      subtitle={
        operation
          ? `${operationKindLabel(operation.kind)} · ${operation.project_name ?? "instance"}`
          : undefined
      }
    >
      {operation && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <DetailField label="Status">
            <StatusBadge
              tone={statusTone(operation.status)}
              label={operation.status}
            />
          </DetailField>
          <DetailField label="Duration">
            {operation.duration_ms > 0
              ? formatDuration(operation.duration_ms)
              : "—"}
          </DetailField>
          <DetailField label="Operation ID" wide>
            <Mono>{operation.id}</Mono>
          </DetailField>
          <DetailField label="Started">
            {operation.started_at
              ? new Date(operation.started_at).toISOString()
              : "—"}
          </DetailField>
          <DetailField label="Finished">
            {operation.finished_at
              ? new Date(operation.finished_at).toISOString()
              : "—"}
          </DetailField>
          {operation.error && (
            <DetailField label="Error" wide>
              <span className="text-[var(--projects-danger)]">
                {operation.error}
              </span>
            </DetailField>
          )}
        </div>
      )}
    </DetailDrawer>
  );
}

function Tile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "success" | "warning";
}) {
  const valueClass =
    tone === "success"
      ? "text-[var(--projects-accent)]"
      : tone === "warning"
        ? "text-[var(--projects-warning)]"
        : "text-[var(--projects-text)]";
  return (
    <article className="rounded-lg border border-[var(--projects-border)] bg-[#141416] px-3.5 py-3">
      <p className="m-0 text-[11px] leading-4 text-[var(--projects-muted)]">
        {label}
      </p>
      <p className={`m-0 text-[17px] font-semibold leading-6 ${valueClass}`}>
        {value}
      </p>
    </article>
  );
}

function Column({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--projects-muted)]">
      {children}
    </span>
  );
}
