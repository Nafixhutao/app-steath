import { StatusBadge, type AdminStatusTone } from "./status-badge";
import type { RunStatus } from "../types/runs";
import type { IncidentSeverity, IncidentStatus } from "../types/incidents";
import type { ProviderStatus } from "../types/platform";

const RUN_STATUS: Record<
  RunStatus,
  { tone: AdminStatusTone; label: string; pulse?: boolean }
> = {
  running: { tone: "info", label: "Running", pulse: true },
  completed: { tone: "success", label: "Completed" },
  failed: { tone: "danger", label: "Failed" },
  queued: { tone: "neutral", label: "Queued" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

/** Semantic badge for an agent run status. */
export function RunStatusBadge({ status }: { status: RunStatus }) {
  const meta = RUN_STATUS[status];
  return <StatusBadge tone={meta.tone} label={meta.label} pulse={meta.pulse} />;
}

const SEVERITY: Record<
  IncidentSeverity,
  { tone: AdminStatusTone; label: string }
> = {
  critical: { tone: "danger", label: "Critical" },
  warning: { tone: "warning", label: "Warning" },
  info: { tone: "info", label: "Info" },
};

/** Severity badge for incidents. */
export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  const meta = SEVERITY[severity];
  return <StatusBadge tone={meta.tone} label={meta.label} />;
}

const INCIDENT_STATUS: Record<
  IncidentStatus,
  { tone: AdminStatusTone; label: string; pulse?: boolean }
> = {
  investigating: { tone: "warning", label: "Investigating", pulse: true },
  identified: { tone: "info", label: "Identified" },
  monitoring: { tone: "info", label: "Monitoring" },
  resolved: { tone: "success", label: "Resolved" },
};

/** Status badge for incidents (investigating → resolved). */
export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const meta = INCIDENT_STATUS[status];
  return <StatusBadge tone={meta.tone} label={meta.label} pulse={meta.pulse} />;
}

/** Service health status → badge (healthy/degraded/down). */
export function ServiceStatusBadge({
  status,
}: {
  status: "healthy" | "degraded" | "down" | ProviderStatus;
}) {
  if (status === "healthy")
    return <StatusBadge tone="success" label="Healthy" />;
  if (status === "degraded")
    return <StatusBadge tone="warning" label="Degraded" pulse />;
  return <StatusBadge tone="danger" label="Down" pulse />;
}
