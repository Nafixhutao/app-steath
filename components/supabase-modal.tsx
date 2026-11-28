"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Dialog chrome shared by every console modal. Owns the backdrop, Escape and
 * backdrop-click closing, the Tab focus trap, and focus restoration to whatever
 * was focused before the dialog opened. Callers supply the header and body.
 *
 * `labelledBy` must name the id of the element that titles the dialog.
 */
export function ModalDialog({
  labelledBy,
  onClose,
  className,
  children,
}: {
  labelledBy?: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusable()[0]?.focus();

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] bg-[rgba(0,0,0,0.7)] [backdrop-filter:blur(4px)] flex items-center justify-center p-[16px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={dialogRef}
        className={`bg-[#16151a] border border-[#282632] rounded-panel w-full max-w-[480px] overflow-hidden [box-shadow:0_20px_50px_rgba(0,0,0,0.6)] animate-[supabaseModalFadeIn_150ms_cubic-bezier(0.16,1,0.3,1)] [&_.supabase-modal-header]:border-b [&_.supabase-modal-header]:border-b-[#23212a] [&_.supabase-modal-header>h2]:m-0 [&_.supabase-modal-header>h2]:text-[16px] [&_.supabase-modal-header>h2]:font-semibold [&_.supabase-modal-header>h2]:text-ink [&_.supabase-modal-body]:p-5 [&_.supabase-modal-footer]:flex [&_.supabase-modal-footer]:items-center [&_.supabase-modal-footer]:justify-end [&_.supabase-modal-footer]:gap-[10px] [&_.supabase-modal-footer]:py-[14px] [&_.supabase-modal-footer]:px-5 [&_.supabase-modal-footer]:border-t [&_.supabase-modal-footer]:border-t-[#23212a] [&_.supabase-modal-footer]:bg-[#141318] [&_.supabase-modal-input]:border [&_.supabase-modal-input]:border-[#2b2935] [&_.supabase-modal-input:focus]:border-[var(--color-accent)]${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Shared dialog shell for the Supabase-style console forms (create project,
 * create service, add variable, add volume, add domain). Callers supply the
 * `<form>` — with `supabase-modal-body` and `supabase-modal-footer` inside it —
 * so the modal owns only the chrome, escape/backdrop closing and a11y wiring.
 */
export function SupabaseModal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <ModalDialog
      labelledBy="supabase-modal-title"
      onClose={onClose}
      className={wide ? "max-w-lg" : undefined}
    >
      <div className="supabase-modal-header flex items-center justify-between py-[18px] px-[20px]">
        <h2 id="supabase-modal-title">{title}</h2>
        <button
          type="button"
          className="supabase-modal-close flex items-center justify-center w-[28px] h-[28px] rounded-control bg-transparent border-0 text-[#716f7c] cursor-pointer [transition:color_150ms,background-color_150ms] hover:text-ink-console hover:bg-[rgba(255,255,255,0.05)]"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {children}
    </ModalDialog>
  );
}
