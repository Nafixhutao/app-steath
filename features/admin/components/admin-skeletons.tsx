import { PixelSkeleton } from "@/components/ui/pixel-skeleton";

/**
 * Admin skeleton compositions built on the ported PixelSkeleton. Each shape
 * mirrors the real row or card so the layout does not shift when data arrives.
 */

/** Incident rows: severity badge, title, status, then the metadata line. */
export function IncidentListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="m-0 list-none p-0" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <li
          key={index}
          className="border-b border-[var(--projects-divider)] px-4 py-3 last:border-b-0"
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <PixelSkeleton className="h-5 w-16 rounded-full" />
            <PixelSkeleton className="h-4 w-48 max-w-[60%]" />
            <PixelSkeleton className="ml-auto h-5 w-20 rounded-full" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <PixelSkeleton className="h-3 w-24" />
            <PixelSkeleton className="h-3 w-32" />
            <PixelSkeleton className="h-3 w-20" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Sign-in provider cards: title, status pill, two inputs, callback, action. */
export function ProviderCardsSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
      {Array.from({ length: cards }, (_, index) => (
        <div
          key={index}
          className="rounded-lg border border-[var(--projects-border)] bg-[var(--projects-control)] p-3.5"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <PixelSkeleton className="h-4 w-16" />
            <PixelSkeleton className="h-5 w-24 rounded-full" />
          </div>
          <PixelSkeleton className="mb-3 h-10 w-full" />
          <PixelSkeleton className="mb-3 h-10 w-full" />
          <PixelSkeleton className="mb-3 h-8 w-full" />
          <PixelSkeleton className="h-9 w-20 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

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
