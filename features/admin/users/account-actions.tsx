"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowUp, Check, Copy, MoreHorizontal } from "lucide-react";
import type { components } from "@/lib/admin/api-schema";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_PLANS,
  planLabel,
  type AccountPlan,
} from "../components/admin-select";

type AdminAccount = components["schemas"]["AdminAccount"];

/** Adjacent subscription tier, or null at the ends of the ladder. */
function stepPlan(plan: AccountPlan, direction: 1 | -1): AccountPlan | null {
  const next = ACCOUNT_PLANS.indexOf(plan) + direction;
  return next < 0 || next >= ACCOUNT_PLANS.length ? null : ACCOUNT_PLANS[next];
}

function validPlan(plan: string): AccountPlan | null {
  return (ACCOUNT_PLANS as readonly string[]).includes(plan)
    ? (plan as AccountPlan)
    : null;
}

function displayNameOf(account: AdminAccount): string {
  return account.display_name?.trim() || account.email;
}

/**
 * Row action menu: a single ellipsis button opening an animated menu with
 * Promote, Demote, and Copy account ID. Same interaction contract as the
 * toolbar dropdowns (outside click and Escape close it), so no new behavior
 * is introduced. The menu flips upward on the last rows so it is never cut
 * by the table scroll container.
 */
export function AccountActions({
  account,
  busy,
  open,
  flipUp,
  onToggle,
  onPlanChange,
}: {
  account: AdminAccount;
  busy?: boolean;
  open: boolean;
  /** Open upward when the row sits at the bottom of the visible table. */
  flipUp?: boolean;
  onToggle: () => void;
  onPlanChange: (plan: AccountPlan) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const reduce = useReducedMotion() ?? false;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onToggle();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onToggle();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [open, onToggle]);

  const plan = validPlan(account.plan);
  const promoteTo = plan ? stepPlan(plan, 1) : null;
  const demoteTo = plan ? stepPlan(plan, -1) : null;
  const name = displayNameOf(account);

  const copyID = () => {
    void navigator.clipboard?.writeText(account.id).catch(() => undefined);
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1400);
  };

  const itemClass =
    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12.5px] leading-none text-[var(--projects-text)] transition-colors hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--projects-accent)] disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${name}`}
        title={`Actions for ${name}`}
        onClick={onToggle}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-md border border-[var(--projects-border)] text-[var(--projects-muted)] transition-colors hover:border-[var(--projects-border-hover)] hover:text-[var(--projects-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--projects-accent)]",
          open &&
            "border-[var(--projects-border-hover)] text-[var(--projects-text)]",
        )}
      >
        <MoreHorizontal size={15} strokeWidth={2} aria-hidden="true" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label={`Actions for ${name}`}
            initial={
              reduce ? false : { opacity: 0, y: flipUp ? 4 : -4, scale: 0.98 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{
              opacity: 0,
              y: flipUp ? 4 : -4,
              scale: 0.98,
              transition: { duration: 0.12 },
            }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "absolute right-0 z-40 w-52 rounded-lg border border-[var(--projects-border)] bg-[#1b1b1e] p-1 shadow-xl shadow-black/40",
              flipUp ? "bottom-full mb-1.5" : "top-full mt-1.5",
            )}
          >
            <button
              type="button"
              role="menuitem"
              disabled={!promoteTo || busy}
              title={
                promoteTo
                  ? `Promote to ${planLabel(promoteTo)}`
                  : "Already on the highest plan"
              }
              onClick={() => {
                if (promoteTo) onPlanChange(promoteTo);
                onToggle();
              }}
              className={itemClass}
            >
              <ArrowUp
                size={14}
                strokeWidth={2}
                aria-hidden="true"
                className="shrink-0 text-[var(--projects-accent)]"
              />
              {promoteTo
                ? `Promote to ${planLabel(promoteTo)}`
                : "Already on Pro"}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!demoteTo || busy}
              title={
                demoteTo
                  ? `Demote to ${planLabel(demoteTo)}`
                  : "Already on the lowest plan"
              }
              onClick={() => {
                if (demoteTo) onPlanChange(demoteTo);
                onToggle();
              }}
              className={itemClass}
            >
              <ArrowDown
                size={14}
                strokeWidth={2}
                aria-hidden="true"
                className="shrink-0 text-[var(--projects-muted)]"
              />
              {demoteTo
                ? `Demote to ${planLabel(demoteTo)}`
                : "Already on Free"}
            </button>
            <div
              aria-hidden="true"
              className="mx-2 my-1 h-px bg-[var(--projects-divider)]"
            />
            <button
              type="button"
              role="menuitem"
              aria-label={copied ? "Copied" : "Copy account ID"}
              onClick={copyID}
              className={itemClass}
            >
              {copied ? (
                <Check
                  size={14}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="shrink-0 text-[var(--projects-accent)]"
                />
              ) : (
                <Copy
                  size={14}
                  strokeWidth={1.8}
                  aria-hidden="true"
                  className="shrink-0 text-[var(--projects-muted)]"
                />
              )}
              {copied ? "Copied" : "Copy account ID"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
