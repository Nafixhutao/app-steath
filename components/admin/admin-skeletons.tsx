"use client";

import { PixelSkeleton } from "@/components/admin/pixel-skeleton";

/**
 * Admin skeleton compositions built on the ported PixelSkeleton. Each shape
 * mirrors the real row or card so the layout does not shift when data arrives.
 */

/** Metric card row: icon, label, big value, sparkline. */
export function MetricCardsSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4"
      aria-hidden="true"
    >
      {Array.from({ length: cards }, (_, index) => (
        <div
          key={index}
          className="flex flex-col gap-2.5 rounded-lg border border-[var(--projects-border)] bg-[#141416] p-3 sm:p-3.5"
        >
          <div className="flex items-center gap-2">
            <PixelSkeleton className="size-6 rounded-md" />
            <PixelSkeleton className="h-3 w-20" />
          </div>
          <PixelSkeleton className="h-6 w-24" />
          <PixelSkeleton className="h-[26px] w-full" />
        </div>
      ))}
    </div>
  );
}

/** Generic panel list: used by tables and log lists awaiting their first page. */
export function PanelRowsSkeleton({
  rows = 6,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={className} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 border-b border-[var(--projects-divider)] px-4 py-3 last:border-b-0"
        >
          <PixelSkeleton className="size-4 shrink-0 rounded" />
          <PixelSkeleton className="h-3.5 min-w-0 flex-1" />
          <PixelSkeleton className="h-3 w-16 shrink-0" />
          <PixelSkeleton className="h-3 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}
