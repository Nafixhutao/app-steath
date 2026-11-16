"use client";

import { RefreshCw } from "lucide-react";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { useEffect, useState } from "react";

/** Pulsing "Live" marker — green while data flows, amber while reconnecting. */
export function LiveIndicator({
  label,
  live = true,
}: {
  label?: string;
  live?: boolean;
}) {
  const text = label ?? (live ? "Live" : "Reconnecting");
  return (
    <AnimatedBadge
      status={live ? "success" : "warning"}
      pulse={live}
      contentKey={text}
      role="status"
      aria-live="polite"
      className="h-9 px-3 text-[12.5px]"
    >
      {text}
    </AnimatedBadge>
  );
}

/** Owns a 1s ticker so the parent page does not re-render every second. */
function useElapsedSeconds(resetKey?: unknown) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [resetKey]);
  return { seconds };
}

/**
 * "Last updated Xs ago" — owns its 1s ticker internally so the parent page
 * (and its charts) do not re-render every second. Reset alongside refreshes.
 */
export function UpdatedLabel({
  resetKey,
  className,
}: {
  resetKey?: unknown;
  className?: string;
}) {
  const { seconds } = useElapsedSeconds(resetKey);
  const label = seconds < 3 ? "just now" : `${seconds}s ago`;
  return (
    <span className={className} aria-live="off">
      Last updated {label}
    </span>
  );
}

/** Square icon button for manual refresh. */
export function RefreshButton({
  onClick,
  label = "Refresh data",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--projects-border)] bg-[#141416] text-[var(--projects-muted)] transition-colors hover:border-[var(--projects-border-hover)] hover:text-[var(--projects-text)]"
    >
      <RefreshCw size={14} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
