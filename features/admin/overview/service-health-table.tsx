import { AdminPanel, AdminPanelHeader } from "../components/admin-panel";
import { ServiceStatusBadge } from "../components/domain-badges";
import type { ComponentStatus } from "./system-status";

function normalizeStatus(status: string): "healthy" | "degraded" | "down" {
  if (status === "healthy") return "healthy";
  if (status === "degraded") return "degraded";
  return "down";
}

/**
 * Service health list — Service and Status per component from the admin
 * overview API. Latency/availability columns were removed because Stealth does
 * not expose per-component probes without the telemetry pipeline.
 */
export function ServiceHealthTable({
  components,
  className,
}: {
  components: ComponentStatus[];
  className?: string;
}) {
  return (
    <AdminPanel className={className}>
      <AdminPanelHeader
        title="Service Health"
        subtitle="Live component status for this instance."
      />
      <ul className="m-0 list-none p-0">
        {components.length === 0 ? (
          <li className="px-3 py-6 text-[13px] text-[var(--projects-muted)]">
            No component status reported.
          </li>
        ) : (
          components.map((component) => (
            <li
              key={component.name}
              className="flex items-center justify-between gap-3 border-b border-[var(--projects-divider)] px-3 py-2.5 transition-colors last:border-b-0 hover:bg-white/[0.02]"
            >
              <span className="text-[13px] font-medium leading-5 text-[var(--projects-text)]">
                {component.name}
              </span>
              <ServiceStatusBadge status={normalizeStatus(component.status)} />
            </li>
          ))
        )}
      </ul>
    </AdminPanel>
  );
}
