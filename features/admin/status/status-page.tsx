"use client";

import Link from "next/link";
import { useStatusReadModel } from "../data/admin-read-model";
import { AdminHeader, AdminPageBody, Mono } from "../components/admin-panel";
import { AdminPanel, AdminPanelHeader } from "../components/admin-panel";
import {
  IncidentStatusBadge,
  SeverityBadge,
} from "../components/domain-badges";
import { StatusBadge } from "../components/status-badge";
import { PanelRowsSkeleton } from "../components/admin-skeletons";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

function componentTone(status: string) {
  if (status === "operational") return "success" as const;
  if (status === "maintenance" || status === "degraded")
    return "warning" as const;
  return "danger" as const;
}

function componentLabel(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Status Page — the configured public status components plus current
 * incidents. The Admin API exposes current state, not a fabricated uptime
 * history, so this view does not draw one.
 */
export function StatusPage() {
  const read = useStatusReadModel();
  const {
    name,
    description,
    isPublic,
    updatedAt,
    components,
    incidents,
    degraded,
  } = read.data;
  const activeIncidents = incidents.filter(
    (incident) => incident.status !== "resolved",
  );

  return (
    <AdminPageBody>
      <AdminHeader
        title="Status Page"
        subtitle="Current component state and published incident activity."
      >
        <Mono className="hidden h-9 items-center rounded-lg border border-[var(--projects-border)] bg-[#141416] px-3 text-[12px] text-[var(--projects-muted)] sm:inline-flex">
          {isPublic ? "public" : "private"}
        </Mono>
      </AdminHeader>

      {read.status === "error" ? (
        <p className="m-0 rounded-lg border border-[var(--projects-border)] bg-[#141416] px-4 py-8 text-center text-[13px] text-[var(--projects-danger)]">
          {read.error}
        </p>
      ) : (
        <>
          <section
            aria-label="Overall status"
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-4 py-4",
              !degraded
                ? "border-[color-mix(in_srgb,var(--projects-accent)_40%,var(--projects-border))] bg-[color-mix(in_srgb,var(--projects-accent)_7%,#141416)]"
                : "border-[color-mix(in_srgb,var(--projects-warning)_40%,var(--projects-border))] bg-[color-mix(in_srgb,var(--projects-warning)_7%,#141416)]",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-2.5 rounded-full",
                !degraded
                  ? "bg-[var(--projects-accent)]"
                  : "bg-[var(--projects-warning)]",
              )}
            />
            <p className="m-0 text-[15px] font-semibold text-[var(--projects-text)]">
              {read.status === "pending"
                ? "Loading status…"
                : !degraded
                  ? "All systems operational"
                  : "Service attention required"}
            </p>
            <Mono className="ml-auto text-[11.5px] text-[var(--projects-muted)]">
              {activeIncidents.length} active incident
              {activeIncidents.length === 1 ? "" : "s"}
            </Mono>
          </section>

          <AdminPanel>
            <AdminPanelHeader
              title={name}
              subtitle={
                description ||
                "Configured components and their current reported state."
              }
              right={
                updatedAt ? (
                  <Mono className="text-[11px] text-[var(--projects-muted)]">
                    updated {formatRelative(updatedAt)}
                  </Mono>
                ) : undefined
              }
            />
            {read.status === "pending" ? (
              <PanelRowsSkeleton rows={5} />
            ) : components.length === 0 ? (
              <p className="m-0 py-8 text-center text-[13px] text-[var(--projects-muted)]">
                No status components are configured.
              </p>
            ) : (
              <ul className="m-0 list-none p-0">
                {components.map((component, index) => (
                  <li
                    key={`${component.name}-${component.status}-${index}`}
                    className="flex flex-wrap items-center gap-3 border-b border-[var(--projects-divider)] py-3 last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--projects-text)]">
                      {component.name}
                    </span>
                    {component.description && (
                      <span className="w-full text-[11.5px] text-[var(--projects-muted)] sm:w-auto sm:flex-1">
                        {component.description}
                      </span>
                    )}
                    <StatusBadge
                      tone={componentTone(component.status)}
                      label={componentLabel(component.status)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </AdminPanel>

          <AdminPanel>
            <AdminPanelHeader
              title="Recent incidents"
              right={
                <Link
                  href="/admin/incidents"
                  className="text-[12px] font-medium text-[var(--projects-muted)] transition-colors hover:text-[var(--projects-text)]"
                >
                  Manage
                </Link>
              }
            />
            <ul className="m-0 list-none p-0">
              {incidents.slice(0, 5).map((incident) => (
                <li
                  key={incident.id}
                  className="flex flex-wrap items-center gap-2.5 border-b border-[var(--projects-divider)] py-2.5 last:border-b-0"
                >
                  <SeverityBadge severity={incident.severity} />
                  <span className="text-[13px] text-[var(--projects-text)]">
                    {incident.title}
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    <Mono className="text-[11px] text-[var(--projects-muted)]">
                      {incident.startedAt}
                    </Mono>
                    <IncidentStatusBadge status={incident.status} />
                  </span>
                </li>
              ))}
              {read.status === "ready" && incidents.length === 0 && (
                <li className="py-8 text-center text-[13px] text-[var(--projects-muted)]">
                  No incidents have been recorded.
                </li>
              )}
            </ul>
          </AdminPanel>
        </>
      )}
    </AdminPageBody>
  );
}
