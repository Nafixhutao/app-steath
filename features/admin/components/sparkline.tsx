import { useId } from "react";
import { cn } from "@/lib/utils";
import type { AdminStatusTone } from "./status-badge";

/** Sparkline tones: the brand accent plus the semantic set. */
export type SparkTone = "accent" | AdminStatusTone;

const STROKE: Record<SparkTone, string> = {
  accent: "var(--projects-accent)",
  success: "var(--projects-accent)",
  warning: "var(--projects-warning)",
  danger: "var(--projects-danger)",
  info: "var(--admin-info)",
  neutral: "#8a8791",
};

/**
 * Tiny inline chart for metric cards — plain SVG (no chart library) so a
 * grid of cards stays cheap to render.
 */
export function Sparkline({
  data,
  tone = "accent",
  height = 28,
  area = true,
  className,
}: {
  data: number[];
  tone?: SparkTone;
  height?: number;
  area?: boolean;
  className?: string;
}) {
  const gradientId = useId().replace(/:/g, "");
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  // A flat series (no change over the window, e.g. stable disk usage) would
  // otherwise pin to the baseline; center it instead.
  const flat = max === min;
  const span = flat ? 1 : max - min;
  const step = 100 / (data.length - 1);
  const points = data.map(
    (value, index) =>
      [index * step, flat ? 50 : 100 - ((value - min) / span) * 100] as const,
  );
  const line = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${round(x)},${round(y)}`)
    .join(" ");
  const fill = `${line} L100,100 L0,100 Z`;
  const color = STROKE[tone];

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("block w-full", className)}
      style={{ height }}
    >
      {area && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={fill} fill={`url(#${gradientId})`} stroke="none" />
        </>
      )}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
