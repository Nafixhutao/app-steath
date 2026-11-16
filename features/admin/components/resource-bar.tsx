import { cn } from "@/lib/utils";

/**
 * Thin horizontal usage bar for host/worker resources. Color follows load:
 * accent → warning → danger, with the numeric value always visible beside it
 * (never color-only).
 */
export function ResourceBar({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  /** Percent 0-100. */
  value: number;
  /** Optional absolute detail, e.g. "13.3 / 16 GB". */
  detail?: string;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, value));
  const tone =
    clamped >= 85
      ? "bg-[var(--projects-danger)]"
      : clamped >= 65
        ? "bg-[var(--projects-warning)]"
        : "bg-[var(--projects-accent)]";

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.07em] text-[var(--projects-muted)]">
          {label}
        </span>
        <span className="admin-mono text-[11.5px] leading-none text-[var(--projects-text)]">
          {Math.round(clamped)}%
          {detail && (
            <span className="ml-1.5 text-[var(--projects-muted)]">
              {detail}
            </span>
          )}
        </span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        aria-label={`${label} usage`}
        className="h-1 w-full overflow-hidden rounded-full bg-[var(--projects-progress-track)]"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            tone,
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
