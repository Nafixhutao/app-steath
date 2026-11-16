import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminStatusTone } from "./status-badge";
import { Sparkline, type SparkTone } from "./sparkline";

/**
 * Compact metric card: icon, label, current value, delta, mini sparkline.
 * Kept intentionally small — a full row of these sits above the charts.
 * `unit` renders beside the value as a smaller baseline-aligned span (used by
 * the Network card) so long rates stay on one line instead of wrapping.
 */
export function MetricCard({
  icon: Icon,
  label,
  value,
  unit,
  hint,
  change,
  changeLabel,
  changeTone = "neutral",
  history,
  sparkTone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  change?: string;
  changeLabel?: string;
  changeTone?: AdminStatusTone;
  history: number[];
  sparkTone?: SparkTone;
}) {
  const changeClass =
    changeTone === "danger"
      ? "text-[var(--projects-danger)]"
      : changeTone === "success"
        ? "text-[var(--projects-accent)]"
        : "text-[var(--projects-muted)]";

  return (
    <article className="flex flex-col gap-2.5 rounded-lg border border-[var(--projects-border)] bg-[#141416] p-3 sm:p-3.5">
      <header className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-[var(--projects-border)] bg-[var(--projects-control)] text-[var(--projects-muted)]">
          <Icon size={13} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <h3 className="m-0 truncate text-[11.5px] font-medium leading-4 text-[var(--projects-muted)]">
          {label}
        </h3>
        {hint && (
          <span className="admin-mono ml-auto hidden shrink-0 text-[11px] leading-4 text-[var(--projects-muted)]/80 sm:inline">
            {hint}
          </span>
        )}
      </header>

      <div className="flex items-end justify-between gap-2">
        {/* Number + unit sit on one shared baseline and never wrap: the value
            span is nowrap and scales down via clamp() on narrow screens, and
            overflow-hidden is only a last-resort clip against pathological
            inputs so the card grid can never be pushed out of shape. */}
        <p className="admin-tnum m-0 flex min-w-0 items-baseline gap-1 overflow-hidden">
          <span className="metric-value-num font-semibold tracking-[-0.02em] text-[var(--projects-text)]">
            {value}
          </span>
          {unit && (
            <span className="metric-value-unit shrink-0 font-medium text-[var(--projects-muted)]">
              {unit}
            </span>
          )}
        </p>
        {change && (
          <p
            className={cn(
              "metric-change m-0 text-right leading-4",
              changeClass,
            )}
          >
            {change}
            {changeLabel && (
              <span className="hidden text-[10.5px] text-[var(--projects-muted)]/70 sm:block">
                {changeLabel}
              </span>
            )}
          </p>
        )}
      </div>

      <Sparkline data={history} tone={sparkTone} height={26} />
    </article>
  );
}
