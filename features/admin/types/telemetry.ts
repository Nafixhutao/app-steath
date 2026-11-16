/** Time-range selector values shared by every telemetry surface. */
export const TIME_RANGES = [
  { value: "1h", label: "Last 1 hour" },
  { value: "6h", label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
] as const;

export type TimeRange = (typeof TIME_RANGES)[number]["value"];

/** Host metrics retain one hour, so its selector must not offer wider ranges. */
export const HOST_TIME_RANGES = [
  { value: "5m", label: "Last 5 minutes" },
  { value: "15m", label: "Last 15 minutes" },
  { value: "1h", label: "Last 1 hour" },
] as const;

export type HostTimeRange = (typeof HOST_TIME_RANGES)[number]["value"];

/** One sampled telemetry point; `timestamp` is a pre-formatted axis label. */
export interface MetricPoint {
  timestamp: string;
  value: number;
}

/** A headline resource metric with its recent history (sparkline/chart). */
export interface SystemMetric {
  id: "cpu" | "memory" | "storage" | "network";
  label: string;
  /** Pre-formatted current value, e.g. "34%" or "9.2 GB". */
  value: string;
  /** Optional secondary read, e.g. "↑ 8 MB/s out" on the network card. */
  hint?: string;
  change: string;
  changeLabel: string;
  tone: "neutral" | "positive" | "negative";
  history: number[];
}

/** Semantic health of a platform service (API, database, workers, providers). */
export interface ServiceHealth {
  id: string;
  name: string;
  status: "healthy" | "degraded" | "down";
  /** Pre-formatted latency ("182 ms") or instance count ("4 instances"). */
  latency: string;
  availability: string;
  lastCheck: string;
}

/** Compact platform statistic shown on the overview grid. */
export interface PlatformStat {
  id: string;
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}
