"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

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
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="supabase-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`supabase-modal-dialog${wide ? " max-w-lg" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="supabase-modal-title"
      >
        <div className="supabase-modal-header">
          <h2 id="supabase-modal-title">{title}</h2>
          <button
            type="button"
            className="supabase-modal-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
