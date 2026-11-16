"use client";

import { useMemo, useState } from "react";
import { useAdminIncidents } from "@/features/admin/data/admin-read-model";
import { useCreateAdminIncident } from "@/features/admin/data/admin-mutations";
import type { components } from "@/lib/admin/api-schema";
import { AdminHeader, AdminPageBody, Mono } from "../components/admin-panel";
import { DetailDrawer, DetailField } from "../components/detail-drawer";
import {
  IncidentStatusBadge,
  SeverityBadge,
} from "../components/domain-badges";
import { StatusBadge } from "../components/status-badge";
import { IncidentListSkeleton } from "../components/admin-skeletons";
import { AdminSelect } from "../components/admin-select";
import { CreateIncidentDialog } from "./create-incident-dialog";
import { toIncident } from "../data/admin-read-model";
import type {
  Incident,
  IncidentSeverity,
  IncidentStatus,
} from "../types/incidents";

type SeverityFilter = "all" | IncidentSeverity;
type StatusFilter = "all" | IncidentStatus;

type CreateIncidentInput = components["schemas"]["CreateAdminIncidentRequest"];

/**
 * Incidents — board of platform incidents with severity/status filters and a
 * detail drawer per incident. Backed by the Stealth admin incidents API.
 */
export function IncidentsPage() {
  const query = useAdminIncidents({ limit: 100 }, { refetchInterval: 30_000 });
  const create = useCreateAdminIncident();
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Incident | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const incidents = useMemo<Incident[]>(
    () => (query.data?.items ?? []).map(toIncident),
    [query.data],
  );

  const visible = useMemo(
    () =>
      incidents.filter((incident) => {
        if (severity !== "all" && incident.severity !== severity) return false;
        if (status !== "all" && incident.status !== status) return false;
        return true;
      }),
    [incidents, severity, status],
  );

  const active = incidents.filter(
    (incident) => incident.status !== "resolved",
  ).length;

  const createIncident = async (input: CreateIncidentInput) => {
    setCreateError(null);
    try {
      await create.mutateAsync(input);
      setCreateOpen(false);
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : "Could not create the incident.",
      );
    }
  };

  return (
    <AdminPageBody>
      <AdminHeader
        title="Incidents"
        subtitle="Track, triage, and resolve platform incidents."
      >
        <Mono className="hidden h-9 items-center rounded-lg border border-[var(--projects-border)] bg-[#141416] px-3 text-[12px] text-[var(--projects-muted)] sm:inline-flex">
          {active} active
        </Mono>
        <button
          type="button"
          onClick={() => {
            setCreateError(null);
            setCreateOpen(true);
          }}
          className="inline-flex h-9 items-center rounded-lg border border-[var(--projects-accent-border)] bg-[var(--projects-accent-strong)] px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[var(--projects-accent-hover)]"
        >
          Create Incident
        </button>
      </AdminHeader>

      <div className="flex flex-wrap items-center gap-2.5">
        <AdminSelect
          label="Filter by severity"
          value={severity}
          onChange={setSeverity}
          options={[
            { value: "all", label: "All severities" },
            { value: "critical", label: "Critical" },
            { value: "warning", label: "Warning" },
            { value: "info", label: "Info" },
          ]}
        />
        <AdminSelect
          label="Filter by status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "All statuses" },
            { value: "investigating", label: "Investigating" },
            { value: "identified", label: "Identified" },
            { value: "monitoring", label: "Monitoring" },
            { value: "resolved", label: "Resolved" },
          ]}
        />
        <Mono className="ml-auto text-[11.5px] text-[var(--projects-muted)]">
          {visible.length} incidents
        </Mono>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--projects-border)] bg-[#141416]">
        {query.isPending ? (
          <IncidentListSkeleton />
        ) : query.error ? (
          <p className="px-4 py-12 text-center text-[13px] text-[var(--projects-danger)]">
            Could not load incidents. Retry shortly.
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {visible.length === 0 ? (
              <li className="px-4 py-12 text-center text-[13px] text-[var(--projects-muted)]">
                No incidents match the current filters.
              </li>
            ) : (
              visible.map((incident) => (
                <li
                  key={incident.id}
                  className="border-b border-[var(--projects-divider)] last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => setSelected(incident)}
                    aria-label={`Inspect incident ${incident.title}`}
                    aria-expanded={selected?.id === incident.id}
                    className="block w-full px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
                  >
                    <div className="flex flex-wrap items-center gap-2.5">
                      <SeverityBadge severity={incident.severity} />
                      <span className="text-[13.5px] font-medium text-[var(--projects-text)]">
                        {incident.title}
                      </span>
                      <span className="ml-auto">
                        <IncidentStatusBadge status={incident.status} />
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--projects-muted)]">
                      <Mono>{incident.id}</Mono>
                      <span>
                        {incident.services.length} service
                        {incident.services.length === 1 ? "" : "s"}:{" "}
                        {incident.services.join(", ")}
                      </span>
                      <span>started {incident.startedAt}</span>
                      <span>{incident.duration}</span>
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      <IncidentDetail incident={selected} onClose={() => setSelected(null)} />

      <CreateIncidentDialog
        open={createOpen}
        pending={create.isPending}
        error={createError}
        onClose={() => setCreateOpen(false)}
        onSubmit={createIncident}
      />
    </AdminPageBody>
  );
}

function IncidentDetail({
  incident,
  onClose,
}: {
  incident: Incident | null;
  onClose: () => void;
}) {
  return (
    <DetailDrawer
      open={incident !== null}
      onClose={onClose}
      title={
        <>
          <span className="truncate">{incident?.title}</span>
          {incident && (
            <span className="ml-2">
              <SeverityBadge severity={incident.severity} />
            </span>
          )}
        </>
      }
      subtitle={incident ? `${incident.id} · ${incident.duration}` : undefined}
    >
      {incident && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-x-4">
            <DetailField label="Status">
              <IncidentStatusBadge status={incident.status} />
            </DetailField>
            <DetailField label="Started">{incident.startedAt}</DetailField>
            <DetailField label="Affected services" wide>
              <span className="flex flex-wrap gap-1.5">
                {incident.services.map((service) => (
                  <Mono
                    key={service}
                    className="rounded-md border border-[var(--projects-border)] px-1.5 py-0.5 text-[11px] text-[var(--projects-muted)]"
                  >
                    {service}
                  </Mono>
                ))}
              </span>
            </DetailField>
          </div>

          <div>
            <p className="m-0 mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--projects-muted)]">
              Timeline
            </p>
            <ol className="m-0 list-none p-0">
              {incident.updates.map((update, index) => (
                <li
                  key={`${update.time}-${index}`}
                  className="relative flex gap-3 pb-4 last:pb-0"
                >
                  {!(incident.updates.length - 1 === index) && (
                    <span
                      aria-hidden="true"
                      className="absolute left-[5px] top-4 h-[calc(100%-14px)] w-px bg-[var(--projects-divider)]"
                    />
                  )}
                  <span
                    className="mt-1 size-[11px] shrink-0 rounded-full bg-[var(--admin-info)]"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="m-0 flex flex-wrap items-center gap-2 text-[12px] leading-4">
                      <StatusBadge tone="neutral" label={update.kind} />
                      <Mono className="text-[11px] text-[var(--projects-muted)]">
                        {update.time}
                      </Mono>
                    </p>
                    <p className="m-0 mt-1 text-[12.5px] leading-5 text-[var(--projects-text)]">
                      {update.message}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </DetailDrawer>
  );
}
