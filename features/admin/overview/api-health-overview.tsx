"use client";

import { Cpu, Server, Timer } from "lucide-react";
import { useAdminAPIMetrics } from "@/features/admin/data/admin-read-model";
import { formatBytes } from "@/lib/format";
import { AdminPanel } from "../components/admin-panel";
import { uptimeLabel } from "./infra-shared";

/**
 * API process vitals strip: goroutines, heap, GC pause, and uptime read
 * directly from the Go runtime at request time. No sampling, no backend —
 * the numbers are the control plane's own.
 */
export function APIHealthOverview() {
  const query = useAdminAPIMetrics();
  const current = query.data;

  return (
    <AdminPanel className="p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--projects-border)] bg-[#0F1013] text-[var(--projects-muted)]"
          >
            <Server size={17} strokeWidth={1.7} />
          </span>
          <div className="min-w-0">
            <h3 className="m-0 truncate text-[13.5px] font-semibold leading-4 text-[var(--projects-text)]">
              API Process
            </h3>
            <p className="m-0 truncate text-[11.5px] leading-4 text-[var(--projects-muted)]">
              {current
                ? `Go ${current.go_version.replace(/^go/, "")} • up ${uptimeLabel(current.process_uptime_seconds)}`
                : "Reading runtime…"}
            </p>
          </div>
        </div>
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Cpu
              size={13}
              className="shrink-0 text-[var(--projects-muted)]"
              aria-hidden="true"
            />
            <dt className="sr-only">Goroutines</dt>
            <dd className="admin-tnum m-0 text-[13px] font-semibold text-[var(--projects-text)]">
              {current ? current.goroutines.toLocaleString() : "—"}
              <span className="ml-1 text-[11px] font-normal text-[var(--projects-muted)]">
                goroutines
              </span>
            </dd>
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <Timer
              size={13}
              className="shrink-0 text-[var(--projects-muted)]"
              aria-hidden="true"
            />
            <dt className="sr-only">Heap and GC</dt>
            <dd className="admin-tnum m-0 text-[13px] font-semibold text-[var(--projects-text)]">
              {current ? formatBytes(current.heap_alloc_bytes) : "—"}
              <span className="ml-1 text-[11px] font-normal text-[var(--projects-muted)]">
                heap
              </span>
              {current && current.last_gc_pause_ms > 0 && (
                <span className="ml-1.5 text-[11px] font-normal text-[var(--projects-muted)]">
                  GC {current.last_gc_pause_ms.toFixed(1)} ms
                </span>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </AdminPanel>
  );
}
