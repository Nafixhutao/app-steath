"use client";

import { useMemo, useState } from "react";
import {
  useErrorsReadModel,
  type AdminErrorGroup,
  type AdminTimeRange,
} from "../data/admin-read-model";
import { useUpdateAdminErrorStatus } from "@/features/admin/data/admin-mutations";
import {
  AdminErrorGroupStatus,
  UpdateAdminErrorGroupStatusRequestStatus,
} from "@/lib/admin/api-schema";
import type { components } from "@/lib/admin/api-schema";
import { AdminHeader, AdminPageBody, Mono } from "../components/admin-panel";
import { StatTile } from "../components/stat-tile";
import { DetailDrawer, DetailField } from "../components/detail-drawer";
import { CopyButton } from "@/components/copy-button";
import { StatusBadge } from "../components/status-badge";
import { AdminSelect } from "../components/admin-select";
import { TimeRangeSelect } from "../components/time-range-select";
import { PanelRowsSkeleton } from "../components/admin-skeletons";
import { formatCount, formatRelative } from "@/lib/format";

type ErrorFilter = "all" | "open" | "acknowledged" | "resolved" | "ignored";
type ErrorLifecycleStatus =
  components["schemas"]["UpdateAdminErrorGroupStatusRequest"]["status"];

function statusTone(status: ErrorLifecycleStatus) {
  if (status === "resolved") return "success" as const;
  if (status === "ignored") return "neutral" as const;
  if (status === "acknowledged") return "warning" as const;
  return "danger" as const;
}

function statusLabel(status: ErrorLifecycleStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * Errors — grouped error fingerprints from the bounded telemetry window.
 * Stack samples and affected-user counts are not part of this API projection,
 * so they are intentionally absent.
 */
export function ErrorsPage() {
  const [range, setRange] = useState<AdminTimeRange>("24h");
  const read = useErrorsReadModel(range);
  const updateStatus = useUpdateAdminErrorStatus();
  const [filter, setFilter] = useState<ErrorFilter>("all");
  const [service, setService] = useState<"all" | string>("all");
  const [selected, setSelected] = useState<AdminErrorGroup | null>(null);

  const services = useMemo(
    () => ["all", ...new Set(read.data.map((group) => group.service))],
    [read.data],
  );
  const visible = useMemo(
    () =>
      read.data.filter((group) => {
        if (filter !== "all" && group.status !== filter) return false;
        if (service !== "all" && group.service !== service) return false;
        return true;
      }),
    [filter, read.data, service],
  );
  const open = read.data.filter(
    (group) => group.status === "open" || group.status === "acknowledged",
  ).length;
  const resolved = read.data.filter(
    (group) => group.status === "resolved",
  ).length;
  const occurrences = read.data.reduce(
    (sum, group) => sum + group.occurrence_count,
    0,
  );

  const setGroupStatus = async (
    group: AdminErrorGroup,
    status: ErrorLifecycleStatus,
  ) => {
    try {
      const updated = await updateStatus.mutateAsync({
        fingerprint: group.fingerprint,
        status,
      });
      if (updated) {
        setSelected((current) =>
          current?.fingerprint === group.fingerprint
            ? {
                ...current,
                status: status as unknown as AdminErrorGroupStatus,
              }
            : current,
        );
      }
    } catch {
      // The mutation state renders the API error; this catch prevents an
      // unhandled rejection from the button's fire-and-forget call.
    }
  };

  return (
    <AdminPageBody>
      <AdminHeader
        title="Errors"
        subtitle="Grouped error signatures across platform services."
      >
        <TimeRangeSelect value={range} onChange={setRange} />
      </AdminHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Groups" value={formatCount(read.data.length)} />
        <StatTile
          label="Open"
          value={formatCount(open)}
          tone={open > 0 ? "danger" : "success"}
        />
        <StatTile
          label="Resolved"
          value={formatCount(resolved)}
          tone="success"
        />
        <StatTile
          label="Occurrences"
          value={formatCount(occurrences)}
          tone={occurrences > 0 ? "warning" : "neutral"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <AdminSelect
          label="Filter by status"
          value={filter}
          onChange={(value) => setFilter(value as ErrorFilter)}
          options={[
            { value: "all", label: "All statuses" },
            { value: "open", label: "Open" },
            { value: "acknowledged", label: "Acknowledged" },
            { value: "resolved", label: "Resolved" },
            { value: "ignored", label: "Ignored" },
          ]}
        />
        <AdminSelect
          label="Filter by service"
          value={service}
          onChange={setService}
          options={services.map((item) => ({
            value: item,
            label: item === "all" ? "All services" : item,
          }))}
        />
        <Mono className="ml-auto text-[11.5px] text-[var(--projects-muted)]">
          {visible.length} groups
        </Mono>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--projects-border)] bg-[#141416]">
        {read.status === "pending" ? (
          <PanelRowsSkeleton rows={8} />
        ) : read.status === "error" ? (
          <p className="m-0 px-4 py-12 text-center text-[13px] text-[var(--projects-danger)]">
            {read.error}
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {visible.map((group) => (
              <li
                key={group.fingerprint}
                className="border-b border-[var(--projects-divider)] last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => setSelected(group)}
                  aria-label={`Inspect error ${group.error_type}`}
                  className="block w-full px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Mono className="text-[13px] font-medium text-[var(--projects-text)]">
                      {group.error_type}
                    </Mono>
                    <StatusBadge
                      tone={statusTone(
                        group.status as unknown as ErrorLifecycleStatus,
                      )}
                      label={statusLabel(
                        group.status as unknown as ErrorLifecycleStatus,
                      )}
                      pulse={group.status === "open"}
                    />
                    <span className="ml-auto text-[12px] text-[var(--projects-muted)]">
                      {group.service}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[var(--projects-muted)]">
                    <span>
                      <Mono className="text-[var(--projects-text)]">
                        {formatCount(group.occurrence_count)}
                      </Mono>{" "}
                      occurrences
                    </span>
                    <span>last seen {formatRelative(group.last_seen)}</span>
                    <span>first seen {formatRelative(group.first_seen)}</span>
                    {group.trace_id && (
                      <Mono className="truncate">{group.trace_id}</Mono>
                    )}
                  </div>
                  <p className="m-0 mt-1.5 truncate text-[12px] leading-4 text-[var(--projects-muted)]/85">
                    {group.message}
                  </p>
                </button>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-4 py-12 text-center text-[13px] text-[var(--projects-muted)]">
                No error groups match the current filters.
              </li>
            )}
          </ul>
        )}
      </div>

      <ErrorDetail
        group={selected}
        pending={updateStatus.isPending}
        error={updateStatus.error?.message ?? null}
        onStatusChange={setGroupStatus}
        onClose={() => setSelected(null)}
      />
    </AdminPageBody>
  );
}

function ErrorDetail({
  group,
  pending,
  error,
  onStatusChange,
  onClose,
}: {
  group: AdminErrorGroup | null;
  pending: boolean;
  error: string | null;
  onStatusChange: (
    group: AdminErrorGroup,
    status: ErrorLifecycleStatus,
  ) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <DetailDrawer
      open={group !== null}
      onClose={onClose}
      title={<Mono className="truncate">{group?.error_type}</Mono>}
      subtitle={
        group
          ? `${group.service} · first seen ${formatRelative(group.first_seen)}`
          : undefined
      }
    >
      {group && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-x-4">
            <DetailField label="Status">
              <StatusBadge
                tone={statusTone(
                  group.status as unknown as ErrorLifecycleStatus,
                )}
                label={statusLabel(
                  group.status as unknown as ErrorLifecycleStatus,
                )}
              />
            </DetailField>
            <DetailField label="Last seen">
              {formatRelative(group.last_seen)}
            </DetailField>
            <DetailField label="Occurrences">
              {formatCount(group.occurrence_count)}
            </DetailField>
            <DetailField label="Service">{group.service}</DetailField>
            <DetailField label="Fingerprint" wide>
              <Mono className="flex items-center gap-1">
                {group.fingerprint}
                <CopyButton text={group.fingerprint} />
              </Mono>
            </DetailField>
            {group.trace_id && (
              <DetailField label="Trace ID" wide>
                <Mono className="flex items-center gap-1">
                  {group.trace_id}
                  <CopyButton text={group.trace_id} />
                </Mono>
              </DetailField>
            )}
          </div>

          <div>
            <p className="m-0 mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--projects-muted)]">
              Message
            </p>
            <p className="m-0 rounded-lg border border-[var(--projects-border)] bg-[#0f0f11] p-3 text-[12.5px] leading-5 text-[var(--projects-text)]">
              {group.message}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {group.status !== "acknowledged" && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  void onStatusChange(
                    group,
                    UpdateAdminErrorGroupStatusRequestStatus.acknowledged,
                  )
                }
                className="inline-flex h-8 items-center rounded-md border border-[var(--projects-border)] px-3 text-[12px] font-medium text-[var(--projects-text)] transition-colors hover:bg-white/[0.04] disabled:opacity-60"
              >
                Acknowledge
              </button>
            )}
            {group.status !== "resolved" && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  void onStatusChange(
                    group,
                    UpdateAdminErrorGroupStatusRequestStatus.resolved,
                  )
                }
                className="inline-flex h-8 items-center rounded-md border border-[var(--projects-accent-border)] bg-[var(--projects-accent-strong)] px-3 text-[12px] font-semibold text-white transition-colors hover:bg-[var(--projects-accent-hover)] disabled:opacity-60"
              >
                Resolve
              </button>
            )}
            {group.status === "resolved" && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  void onStatusChange(
                    group,
                    UpdateAdminErrorGroupStatusRequestStatus.open,
                  )
                }
                className="inline-flex h-8 items-center rounded-md border border-[var(--projects-border)] px-3 text-[12px] font-medium text-[var(--projects-text)] transition-colors hover:bg-white/[0.04] disabled:opacity-60"
              >
                Reopen
              </button>
            )}
          </div>
          {error && (
            <p className="m-0 text-[12px] text-[var(--projects-danger)]">
              {error}
            </p>
          )}
        </div>
      )}
    </DetailDrawer>
  );
}
