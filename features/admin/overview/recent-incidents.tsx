import Link from "next/link";
import { AdminPanel, AdminPanelHeader, Mono } from "../components/admin-panel";
import {
  IncidentStatusBadge,
  SeverityBadge,
} from "../components/domain-badges";
import type { Incident } from "../types/incidents";

/** Latest incidents, linking into the incidents board. */
export function RecentIncidents({
  incidents,
  limit = 3,
  className,
}: {
  incidents: Incident[];
  limit?: number;
  className?: string;
}) {
  const visible = incidents.slice(0, limit);

  return (
    <AdminPanel className={className}>
      <AdminPanelHeader
        title="Recent Incidents"
        right={
          <Link
            href="/admin/incidents"
            className="text-[12px] font-medium text-[var(--projects-muted)] transition-colors hover:text-[var(--projects-text)]"
          >
            View all
          </Link>
        }
      />
      <ul className="m-0 list-none p-0">
        {visible.length === 0 ? (
          <li className="px-1 py-6 text-[13px] text-[var(--projects-muted)]">
            No incidents reported.
          </li>
        ) : (
          visible.map((incident) => (
            <li
              key={incident.id}
              className="border-b border-[var(--projects-divider)] last:border-b-0"
            >
              <Link
                href="/admin/incidents"
                className="block px-1 py-3 transition-colors first:pt-1 last:pb-1 hover:bg-white/[0.02]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={incident.severity} />
                  <span className="text-[13px] font-medium leading-5 text-[var(--projects-text)]">
                    {incident.title}
                  </span>
                  <span className="ml-auto">
                    <IncidentStatusBadge status={incident.status} />
                  </span>
                </div>
                <p className="m-0 mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] leading-4 text-[var(--projects-muted)]">
                  <Mono>{incident.id}</Mono>
                  <span aria-hidden="true">·</span>
                  <span>{incident.services.join(", ")}</span>
                  <span aria-hidden="true">·</span>
                  <span>{incident.startedAt}</span>
                </p>
              </Link>
            </li>
          ))
        )}
      </ul>
    </AdminPanel>
  );
}
