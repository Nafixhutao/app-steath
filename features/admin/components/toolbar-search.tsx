import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Bordered search input used in admin toolbars. */
export function ToolbarSearch({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-[var(--projects-border)] bg-[#141416] px-3 transition-colors hover:border-[var(--projects-border-hover)] focus-within:border-[var(--projects-border-hover)] focus-within:ring-1 focus-within:ring-[var(--projects-accent)]/40 sm:max-w-[320px]",
        className,
      )}
    >
      <Search
        size={14}
        strokeWidth={1.8}
        className="shrink-0 text-[var(--projects-muted)]"
        aria-hidden="true"
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type="search"
        name="admin-search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        inputMode="search"
        placeholder={placeholder}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-[12.5px] leading-none text-[var(--projects-text)] outline-none placeholder:text-[var(--projects-muted)] [&::-webkit-search-cancel-button]:hidden"
      />
      {value !== "" && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded text-[var(--projects-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--projects-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--projects-accent)]"
        >
          <X size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </label>
  );
}

/** Live-tail toggle: pressed state keeps the stream appending entries. */
export function LiveToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={enabled}
      onClick={() => onChange(!enabled)}
      className={
        enabled
          ? "inline-flex h-9 items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--projects-accent)_45%,var(--projects-border))] bg-[color-mix(in_srgb,var(--projects-accent)_12%,transparent)] px-3 text-[12.5px] font-medium text-[var(--projects-accent)]"
          : "inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--projects-border)] bg-[#141416] px-3 text-[12.5px] font-medium text-[var(--projects-muted)] transition-colors hover:border-[var(--projects-border-hover)] hover:text-[var(--projects-text)]"
      }
    >
      <span className="relative flex size-2">
        {enabled && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--projects-accent)] opacity-50" />
        )}
        <span
          className={
            enabled
              ? "relative inline-flex size-2 rounded-full bg-[var(--projects-accent)]"
              : "relative inline-flex size-2 rounded-full bg-[var(--projects-ring)]"
          }
        />
      </span>
      Live tail {enabled ? "on" : "off"}
    </button>
  );
}
