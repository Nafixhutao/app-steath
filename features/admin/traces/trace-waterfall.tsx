"use client";

import { formatDuration } from "../lib/format";
import type { TraceSpan } from "../types/traces";
import type { ChartTone } from "../components/telemetry-chart";

/** Restrained per-service bar coloring — unknown services fall back to muted. */
const SERVICE_TONE: Record<string, ChartTone> = {
  api: "accent",
  worker: "accent",
  database: "info",
  redis: "muted",
  queue: "muted",
  auth: "muted",
  sandbox: "warning",
  openai: "info",
  anthropic: "info",
  gateway: "info",
  storage: "muted",
};

const TONE_BAR: Record<ChartTone, string> = {
  accent: "bg-[var(--projects-accent)]",
  info: "bg-[var(--admin-info)]",
  warning: "bg-[var(--projects-warning)]",
  danger: "bg-[var(--projects-danger)]",
  muted: "bg-[#8a8791]",
};

/**
 * Span waterfall for the trace detail: each span renders a bar positioned by
 * its start offset across the trace duration, with the duration printed next
 * to it (so the chart never carries information on its own).
 */
export function TraceWaterfall({
  spans,
  totalDuration,
}: {
  spans: TraceSpan[];
  totalDuration: number;
}) {
  return (
    <div>
      <div
        className="admin-mono mb-1 flex justify-between border-b border-[var(--projects-divider)] pb-1 text-[10px] leading-4 text-[var(--projects-muted)]"
        aria-hidden="true"
      >
        <span>{formatDuration(0)}</span>
        <span>{formatDuration(totalDuration / 2)}</span>
        <span>{formatDuration(totalDuration)}</span>
      </div>
      <ul className="m-0 list-none p-0">
        {spans.map((span) => {
          const tone =
            span.status === "error"
              ? "danger"
              : (SERVICE_TONE[span.service] ?? "muted");
          const left = Math.min(100, (span.start / totalDuration) * 100);
          const width = Math.max(1.2, (span.duration / totalDuration) * 100);
          const label =
            span.status === "error"
              ? `${formatDuration(span.duration)} · error`
              : formatDuration(span.duration);
          // Labels flip to the left of the bar when they would overflow.
          const overflow = left + width > 80;
          return (
            <li
              key={span.id}
              className="grid grid-cols-[minmax(0,44%)_minmax(0,1fr)] items-center gap-x-3 border-b border-[var(--projects-divider)] py-1.5 last:border-b-0"
            >
              <div className="min-w-0">
                <p
                  className="m-0 truncate text-[12px] leading-4 text-[var(--projects-text)]"
                  title={span.name}
                >
                  {span.name}
                </p>
                <p className="m-0 text-[10.5px] leading-3 text-[var(--projects-muted)]">
                  {span.service}
                </p>
              </div>
              <div className="relative h-4 min-w-0">
                <span
                  className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-full ${TONE_BAR[tone]}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
                <span
                  className={`admin-mono absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[10.5px] leading-none ${
                    span.status === "error"
                      ? "text-[var(--projects-danger)]"
                      : "text-[var(--projects-muted)]"
                  }`}
                  style={
                    overflow
                      ? { right: `${100 - left}%`, marginRight: 8 }
                      : { left: `${left + width}%`, marginLeft: 8 }
                  }
                >
                  {label}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
