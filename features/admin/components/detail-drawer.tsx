"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { EASE_DRAWER } from "@/lib/ease";
import type { ReactNode } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Right-hand detail drawer over a backdrop — the log/trace/run detail
 * surface. Portal-based like MobileSheet; Escape closes, Tab is trapped,
 * body scroll locks, and focus moves in/out on open/close.
 */
export function DetailDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const reduce = useReducedMotion() ?? false;

  useEffect(() => {
    if (!open) return;
    const panel = document.getElementById("admin-detail-drawer");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const body = document.body;
    body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      body.style.overflow = "";
    };
  }, [open, onClose]);

  // The portal target only exists after hydration; the toggle buttons that
  // open this drawer are client-only interactions anyway.
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
            className="fixed inset-0 z-[60] bg-black/50"
          />
          <motion.aside
            key="drawer-panel"
            id="admin-detail-drawer"
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            initial={{ x: reduce ? 0 : "108%", opacity: reduce ? 0 : 1 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{
              x: reduce ? 0 : "108%",
              opacity: reduce ? 0 : 1,
              transition: { duration: 0.18 },
            }}
            transition={{ duration: 0.3, ease: EASE_DRAWER }}
            className="admin-scrollbar fixed bottom-0 right-0 top-0 z-[61] flex w-full max-w-[480px] flex-col overflow-y-auto border-l border-[var(--projects-border)] bg-[#141416] shadow-2xl shadow-black/50"
          >
            <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-[var(--projects-divider)] bg-[#141416]/95 px-5 py-4 backdrop-blur">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-[var(--projects-text)]">
                  {title}
                </div>
                {subtitle && (
                  <p className="m-0 mt-1 text-[12px] leading-4 text-[var(--projects-muted)]">
                    {subtitle}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close detail panel"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-[var(--projects-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--projects-text)]"
              >
                <X size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </header>
            <div className="flex-1 px-5 py-4">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Label/value row used inside detail drawers. `wide` spans both columns. */
export function DetailField({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-0.5 border-b border-[var(--projects-divider)] py-2 last:border-b-0 ${
        wide ? "col-span-2" : ""
      }`}
    >
      <span className="text-[11px] uppercase tracking-[0.06em] text-[var(--projects-muted)]">
        {label}
      </span>
      <span className="min-w-0 break-words text-[12.5px] leading-4 text-[var(--projects-text)]">
        {children}
      </span>
    </div>
  );
}
