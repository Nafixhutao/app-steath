"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Copy-to-clipboard button with a brief "copied" confirmation. */
export function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const handleCopy = () => {
    // Mock-data friendly: clipboard may be unavailable; feedback is local state.
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--projects-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--projects-text)]",
        className,
      )}
    >
      {copied ? (
        <Check
          size={12}
          strokeWidth={2.2}
          className="text-[var(--projects-accent)]"
          aria-hidden="true"
        />
      ) : (
        <Copy size={12} strokeWidth={1.8} aria-hidden="true" />
      )}
    </button>
  );
}
