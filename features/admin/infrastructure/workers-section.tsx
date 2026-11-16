"use client";

import { AdminPanel, AdminPanelHeader, Mono } from "../components/admin-panel";
import { StatusBadge } from "../components/status-badge";
import type { AdminOperationSummary } from "../data/admin-read-model";

/**
 * The Admin API exposes durable operation counts, not worker identities.
 * Keep this section honest: show the execution queue the control plane owns.
 */
export function WorkersSection({
  operations,
  className,
}: {
  operations: AdminOperationSummary | undefined;
  className?: string;
}) {
  const counts = [
    {
      label: "Queued",
      value: operations?.queued_jobs,
      tone: "neutral" as const,
    },
    {
      label: "Running",
      value: operations?.running_jobs,
      tone: "success" as const,
    },
    {
      label: "Failed",
      value: operations?.failed_jobs,
      tone: "danger" as const,
    },
  ];
  return (
    <AdminPanel className={className}>
      <AdminPanelHeader
        title="Execution Queue"
        subtitle="Durable control-plane work waiting for, or held by, trusted workers."
        right={
          <Mono className="text-[11.5px] text-[var(--projects-muted)]">
            live snapshot
          </Mono>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {counts.map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-[var(--projects-border)] bg-[var(--projects-control)] p-3.5"
          >
            <StatusBadge tone={item.tone} label={item.label} />
            <Mono className="mt-3 block text-[22px] font-semibold leading-7 text-[var(--projects-text)]">
              {item.value ?? "—"}
            </Mono>
          </div>
        ))}
      </div>
    </AdminPanel>
  );
}
