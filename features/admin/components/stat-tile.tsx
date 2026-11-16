import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Small labeled stat used in summary rows (platform metrics, host summary,
 * usage tiles). Value strings arrive pre-formatted from the Admin read model.
 */
export function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
  className,
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  className?: string;
}) {
  const valueClass =
    tone === "danger"
      ? "text-[var(--projects-danger)]"
      : tone === "warning"
        ? "text-[var(--projects-warning)]"
        : tone === "success"
          ? "text-[var(--projects-accent)]"
          : "text-[var(--projects-text)]";

  return (
    <article
      className={cn(
        "flex items-center gap-3 rounded-lg border border-[var(--projects-border)] bg-[#141416] px-3.5 py-3",
        className,
      )}
    >
      {Icon && (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-[var(--projects-border)] bg-[var(--projects-control)] text-[var(--projects-muted)]">
          <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0">
        <p className="m-0 truncate text-[11px] leading-4 text-[var(--projects-muted)]">
          {label}
        </p>
        <p
          className={cn(
            "m-0 truncate text-[17px] font-semibold leading-6 tracking-[-0.01em]",
            valueClass,
          )}
        >
          {value}
          {hint && (
            <span className="ml-1.5 text-[11.5px] font-normal text-[var(--projects-muted)]">
              {hint}
            </span>
          )}
        </p>
      </div>
    </article>
  );
}
