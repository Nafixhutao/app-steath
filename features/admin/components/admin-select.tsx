"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { SPRING_PRESS } from "@/lib/ease";

export interface AdminSelectOption<T extends string> {
  value: T;
  label: string;
}

export const ACCOUNT_PLANS = ["free", "go", "plus", "pro"] as const;
export type AccountPlan = (typeof ACCOUNT_PLANS)[number];

export function planLabel(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/**
 * Compact dropdown used across admin toolbars (time range, level, status...).
 * Same interaction contract as the customer toolbar dropdown: pointer-outside
 * closes, Escape closes, options are `menuitemradio` with aria-checked.
 */
export function AdminSelect<T extends string>({
  value,
  options,
  onChange,
  label,
  icon,
  search = false,
  align = "left",
  className,
  disabled = false,
}: {
  value: T;
  options: ReadonlyArray<AdminSelectOption<T>>;
  onChange: (value: T) => void;
  /** Accessible name for the trigger. */
  label: string;
  icon?: ReactNode;
  /** Render a filter field inside the menu (long lists like models). */
  search?: boolean;
  align?: "left" | "right";
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const reduce = useReducedMotion() ?? false;

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- verbatim from stealth-forge
      setQuery("");
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const current = options.find((option) => option.value === value);
  const normalizedQuery = query.trim().toLowerCase();
  const visible = normalizedQuery
    ? options.filter((option) =>
        option.label.toLowerCase().includes(normalizedQuery),
      )
    : options;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--projects-border)] bg-[#141416] px-3 text-[12.5px] font-medium leading-none text-[var(--projects-text)] transition-colors hover:border-[var(--projects-border-hover)] disabled:opacity-60",
          open && "border-[var(--projects-border-hover)]",
        )}
      >
        {icon && (
          <span className="shrink-0 text-[var(--projects-muted)]">{icon}</span>
        )}
        <span className="max-w-[170px] truncate">
          {current?.label ?? value}
        </span>
        <ChevronDown
          size={13}
          strokeWidth={1.8}
          className={cn(
            "shrink-0 text-[var(--projects-muted)] transition-transform duration-150",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            id={menuId}
            initial={reduce ? false : { opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{
              opacity: 0,
              y: -4,
              scale: 0.98,
              transition: { duration: 0.12 },
            }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "absolute top-full z-40 mt-1.5 min-w-[168px] rounded-lg border border-[var(--projects-border)] bg-[#1b1b1e] p-1 shadow-xl shadow-black/40",
              align === "right" ? "right-0" : "left-0",
            )}
          >
            {search && (
              <label className="mb-1 flex h-8 items-center gap-2 rounded-md border border-[var(--projects-border)] px-2.5">
                <Search
                  size={13}
                  strokeWidth={1.8}
                  className="shrink-0 text-[var(--projects-muted)]"
                  aria-hidden="true"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter..."
                  aria-label={`Filter ${label}`}
                  className="min-w-0 flex-1 bg-transparent text-[12px] leading-none text-[var(--projects-text)] outline-none placeholder:text-[var(--projects-muted)]"
                />
              </label>
            )}
            <div className="admin-scrollbar max-h-[260px] overflow-y-auto">
              {visible.length === 0 ? (
                <p className="m-0 px-2.5 py-2 text-[12px] text-[var(--projects-muted)]">
                  No matches.
                </p>
              ) : (
                visible.map((option) => (
                  <motion.button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={option.value === value}
                    whileTap={reduce ? undefined : { scale: 0.98 }}
                    transition={SPRING_PRESS}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[12.5px] leading-none text-[var(--projects-text)] transition-colors hover:bg-white/[0.05]"
                  >
                    {option.label}
                    {option.value === value && (
                      <Check
                        size={13}
                        strokeWidth={2}
                        className="shrink-0 text-[var(--projects-accent)]"
                        aria-hidden="true"
                      />
                    )}
                  </motion.button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
