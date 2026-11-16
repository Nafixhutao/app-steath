"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import type { MetricPoint } from "../types/telemetry";

export type ChartTone = "accent" | "info" | "warning" | "danger" | "muted";

const STROKE: Record<ChartTone, string> = {
  accent: "var(--projects-accent)",
  info: "var(--admin-info)",
  warning: "var(--projects-warning)",
  danger: "var(--projects-danger)",
  muted: "#8a8791",
};

export interface ChartSeries {
  key: string;
  label: string;
  tone: ChartTone;
}

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | string | Array<number | string>;
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
  series,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  unit: string;
  series: ChartSeries[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-[var(--projects-border)] bg-[#1b1b1e]/95 px-3 py-2 shadow-xl shadow-black/40 backdrop-blur">
      <p className="admin-mono m-0 text-[11px] leading-4 text-[var(--projects-muted)]">
        {label}
      </p>
      {payload.map((entry) => {
        const meta = series.find((item) => item.key === entry.dataKey);
        const raw = Array.isArray(entry.value) ? entry.value[0] : entry.value;
        return (
          <p
            key={String(entry.dataKey)}
            className="m-0 mt-1 flex items-center gap-2 text-[12px] leading-4"
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{
                background: meta ? STROKE[meta.tone] : "var(--projects-muted)",
              }}
              aria-hidden="true"
            />
            <span className="text-[var(--projects-muted)]">
              {meta?.label ?? String(entry.dataKey)}
            </span>
            <span className="admin-mono ml-auto pl-3 text-[var(--projects-text)]">
              {typeof raw === "number" ? formatValue(raw) : String(raw ?? "—")}
              {unit}
            </span>
          </p>
        );
      })}
    </div>
  );
}

function formatValue(value: number): string {
  return Math.abs(value) >= 100
    ? String(Math.round(value))
    : String(Math.round(value * 10) / 10);
}

// X-axis labels are ISO timestamps from the API. Render them as a compact
// wall-clock time; non-date labels pass through.
function formatAxisTime(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * The shared telemetry chart: a restrained recharts area/bar with subtle
 * grid, dark tooltip, and per-series gradient fill. All colors resolve to
 * CSS variables so light theme keeps working.
 */
export function TelemetryChart({
  data,
  series,
  unit,
  type = "area",
  height = 220,
  yMin,
  yMax,
  className,
}: {
  data: MetricPoint[];
  series: ChartSeries[];
  unit: string;
  type?: "area" | "bar";
  height?: number;
  yMin?: number;
  yMax?: number;
  className?: string;
}) {
  const gradientBase = useId().replace(/:/g, "");

  if (type === "bar") {
    return (
      <ResponsiveContainer width="100%" height={height} className={className}>
        <BarChart
          data={data}
          margin={{ top: 6, right: 4, bottom: 0, left: -18 }}
        >
          <CartesianGrid
            stroke="var(--projects-border)"
            strokeOpacity={0.4}
            strokeDasharray="3 6"
            vertical={false}
          />
          <XAxis
            dataKey="timestamp"
            tick={{ fill: "#8a8791", fontSize: 10.5 }}
            tickLine={false}
            axisLine={false}
            minTickGap={32}
            tickMargin={6}
            tickFormatter={formatAxisTime}
          />
          <YAxis
            tick={{ fill: "#8a8791", fontSize: 10.5 }}
            tickLine={false}
            axisLine={false}
            width={46}
            domain={yMax !== undefined ? [yMin ?? 0, yMax] : ["auto", "auto"]}
            tickFormatter={(value: number) => formatValue(value)}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            content={<ChartTooltip unit={unit} series={series} />}
          />
          {series.map((item) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              name={item.label}
              fill={STROKE[item.tone]}
              fillOpacity={0.55}
              radius={[2, 2, 0, 0]}
              maxBarSize={18}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height} className={className}>
      <AreaChart
        data={data}
        margin={{ top: 6, right: 4, bottom: 0, left: -18 }}
      >
        <defs>
          {series.map((item) => (
            <linearGradient
              key={item.key}
              id={`${gradientBase}-${item.key}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor={STROKE[item.tone]}
                stopOpacity={0.2}
              />
              <stop
                offset="100%"
                stopColor={STROKE[item.tone]}
                stopOpacity={0.01}
              />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid
          stroke="var(--projects-border)"
          strokeOpacity={0.4}
          strokeDasharray="3 6"
          vertical={false}
        />
        <XAxis
          dataKey="timestamp"
          tick={{ fill: "#8a8791", fontSize: 10.5 }}
          tickLine={false}
          axisLine={false}
          minTickGap={32}
          tickMargin={6}
          tickFormatter={formatAxisTime}
        />
        <YAxis
          tick={{ fill: "#8a8791", fontSize: 10.5 }}
          tickLine={false}
          axisLine={false}
          width={46}
          domain={yMax !== undefined ? [yMin ?? 0, yMax] : ["auto", "auto"]}
          tickFormatter={(value: number) => formatValue(value)}
        />
        <Tooltip
          cursor={{ stroke: "rgba(255,255,255,0.16)", strokeDasharray: "3 3" }}
          content={<ChartTooltip unit={unit} series={series} />}
        />
        {series.map((item) => (
          <Area
            key={item.key}
            type="monotone"
            dataKey={item.key}
            name={item.label}
            stroke={STROKE[item.tone]}
            strokeWidth={1.6}
            fill={`url(#${gradientBase}-${item.key})`}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Small segmented control for chart metric tabs (CPU / Memory / ...). */
export function ChartTabs<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex items-center gap-0.5 rounded-lg border border-[var(--projects-border)] bg-[#141416] p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium leading-none transition-colors",
            option.value === value
              ? "bg-[color-mix(in_srgb,var(--projects-accent)_14%,transparent)] text-[var(--projects-accent)]"
              : "text-[var(--projects-muted)] hover:text-[var(--projects-text)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
