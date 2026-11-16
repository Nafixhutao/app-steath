"use client";

import { ArrowRight, Package } from "lucide-react";
import { StatusBadge } from "../components/status-badge";
import type { components } from "@/lib/admin/api-schema";

type AdminRecentDeployment = components["schemas"]["AdminRecentDeployment"];

function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/**
 * The Overview's recent-activity list: the newest App deployments across all
 * projects. Statuses mirror the Apps page vocabulary; an empty list means the
 * platform genuinely has no deployments, so the panel says that plainly.
 */
export function RecentDeployments({
  deployments,
}: {
  deployments: AdminRecentDeployment[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {deployments.length === 0 ? (
        <p className="m-0 px-1 py-2 text-[12.5px] leading-5 text-[var(--projects-muted)]">
          No App deployments yet. Deployments appear here as soon as an App
          build is queued.
        </p>
      ) : (
        deployments.map((deployment) => (
          <div
            key={deployment.id}
            className="flex items-center gap-3 rounded-lg border border-[var(--projects-border)] bg-[#141416] px-3 py-2"
          >
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-md border border-[var(--projects-border)] bg-[var(--projects-control)] text-[var(--projects-muted)]"
            >
              <Package size={14} strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-[13px] font-medium leading-4 text-[var(--projects-text)]">
                {deployment.app_name}
                <span className="ml-1.5 text-[11.5px] font-normal text-[var(--projects-muted)]">
                  v{deployment.version}
                </span>
              </p>
              <p className="m-0 truncate text-[11.5px] leading-4 text-[var(--projects-muted)]">
                {relativeTime(deployment.created_at)}
              </p>
            </div>
            <StatusBadge
              tone={
                deployment.status === "ready" &&
                deployment.build_status === "succeeded"
                  ? "success"
                  : deployment.build_status === "failed" ||
                      deployment.status === "failed"
                    ? "danger"
                    : "info"
              }
              label={
                deployment.build_status === "failed"
                  ? "Build failed"
                  : deployment.build_status === "building" ||
                      deployment.build_status === "queued"
                    ? "Building"
                    : deployment.status === "ready"
                      ? "Deployed"
                      : deployment.status
              }
            />
            <ArrowRight
              size={14}
              className="hidden shrink-0 text-[var(--projects-muted)] sm:block"
              aria-hidden="true"
            />
          </div>
        ))
      )}
    </div>
  );
}
