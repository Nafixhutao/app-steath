"use client";

import { AnimatedBadge } from "@/components/motion/animated-badge";
import { cn } from "@/lib/utils";

export type AdminStatusTone =
  "success" | "warning" | "danger" | "info" | "neutral";

/**
 * Status chip for the admin area, rendered by the shared AnimatedBadge so the
 * admin and console surfaces share one status primitive. `tone` maps directly
 * onto the badge's semantic tones.
 */
export function StatusBadge({
  tone,
  label,
  pulse = false,
  className,
}: {
  tone: AdminStatusTone;
  label: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <AnimatedBadge
      status={tone}
      size="sm"
      pulse={pulse}
      contentKey={label}
      className={cn("font-medium", className)}
    >
      {label}
    </AnimatedBadge>
  );
}
