import type { components } from "@/lib/admin/api-schema";
import { formatRelative } from "@/lib/format";
import type { Host, ResourceSeries } from "../../types/infrastructure";
import type { Incident, IncidentUpdate } from "../../types/incidents";
import type { LogEntry, LogLevel } from "../../types/logs";
import type { MetricPoint } from "../../types/telemetry";
import type { SpanStatus, Trace, TraceSpan } from "../../types/traces";
import type {
  AdminHostMetricsSnapshot,
  AdminLog,
  AdminOperation,
  AdminOperationSummary,
  AdminStatusPage,
  AdminTraceSpan,
  ExecutionQueueProjection,
  ProviderProjection,
  RunProjection,
  StatusProjection,
  UsageProjection,
} from "./types";

const GIB = 1024 ** 3;

function percent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

function round(value: number, places = 0): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function formatChartTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toISOString().slice(11, 16);
}

function seriesStats(data: MetricPoint[]) {
  const values = data.map((point) => point.value);
  if (values.length === 0) return { peak: 0, average: 0 };
  return {
    peak: Math.max(...values),
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

export function hostFromMetrics(
  snapshot: AdminHostMetricsSnapshot | undefined,
  runningJobs = 0,
): Host | null {
  if (!snapshot) return null;
  const current = snapshot.current;
  return {
    id: "api-host",
    name: "API host",
    status: "online",
    os: "runtime host",
    ip: "local",
    region: "in-process",
    cpu: round(current.cpu_percent),
    memory: round(
      percent(current.memory_used_bytes, current.memory_total_bytes),
    ),
    storage: round(percent(current.disk_used_bytes, current.disk_total_bytes)),
    memoryTotalGb: round(current.memory_total_bytes / GIB, 1),
    storageTotalGb: round(current.disk_total_bytes / GIB, 1),
    uptime: "—",
    workers: 0,
    jobs: runningJobs,
  };
}

export function resourceSeriesFromMetrics(
  snapshot: AdminHostMetricsSnapshot | undefined,
): ResourceSeries[] {
  if (!snapshot) return [];
  const history = snapshot.history;
  const cpu: MetricPoint[] = history.map((sample) => ({
    timestamp: formatChartTime(sample.timestamp),
    value: round(sample.cpu_percent, 1),
  }));
  const memory: MetricPoint[] = history.map((sample) => ({
    timestamp: formatChartTime(sample.timestamp),
    value: round(sample.memory_used_bytes / GIB, 2),
  }));
  const disk: MetricPoint[] = history.map((sample) => ({
    timestamp: formatChartTime(sample.timestamp),
    value: round(sample.disk_used_bytes / GIB, 2),
  }));
  const network: MetricPoint[] = history.map((sample) => ({
    timestamp: formatChartTime(sample.timestamp),
    value: round(
      (sample.network_rx_bytes_per_sec + sample.network_tx_bytes_per_sec) /
        (1024 * 1024),
      2,
    ),
  }));

  return [
    resourceSeries("cpu", "CPU", "%", "accent", cpu, "%"),
    resourceSeries("memory", "Memory", "GB", "info", memory, " GB"),
    resourceSeries("disk", "Disk", "GB", "warning", disk, " GB"),
    resourceSeries("network", "Network", "MB/s", "muted", network, " MB/s"),
  ];
}

function resourceSeries(
  id: ResourceSeries["id"],
  label: string,
  unit: string,
  tone: ResourceSeries["tone"],
  data: MetricPoint[],
  suffix: string,
): ResourceSeries {
  const stats = seriesStats(data);
  const latest = data[data.length - 1]?.value ?? 0;
  return {
    id,
    label,
    unit,
    tone,
    current: `${round(latest, id === "cpu" ? 0 : 1)}${suffix}`,
    peak: `${round(stats.peak, id === "cpu" ? 0 : 1)}${suffix}`,
    average: `${round(stats.average, id === "cpu" ? 0 : 1)}${suffix}`,
    data,
  };
}

export function cpuHistoryFromMetrics(
  snapshot: AdminHostMetricsSnapshot | undefined,
): number[] {
  return snapshot?.history.map((sample) => round(sample.cpu_percent)) ?? [];
}

function normalizeRunStatus(status: string): RunProjection["status"] {
  if (status === "running") return "running";
  if (status === "completed" || status === "succeeded") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  return "queued";
}

export function runFromOperation(operation: AdminOperation): RunProjection {
  return {
    id: operation.id,
    agent: operation.name,
    project: operation.project_name ?? "—",
    status: normalizeRunStatus(operation.status),
    durationMs: operation.duration_ms,
    startedAt: formatRelative(operation.started_at ?? operation.created_at),
    error: operation.error ?? null,
  };
}

export function executionQueueFromOperations(
  operations: AdminOperation[],
  summary: AdminOperationSummary | null,
): ExecutionQueueProjection {
  return {
    summary,
    items: operations,
    queued:
      summary?.queued_jobs ??
      operations.filter((item) => normalizeRunStatus(item.status) === "queued")
        .length,
    running:
      summary?.running_jobs ??
      operations.filter((item) => normalizeRunStatus(item.status) === "running")
        .length,
    failed:
      summary?.failed_jobs ??
      operations.filter((item) => normalizeRunStatus(item.status) === "failed")
        .length,
  };
}

function normalizeLogLevel(level: string | undefined): LogLevel {
  switch (level?.toLowerCase()) {
    case "warn":
    case "warning":
      return "WARN";
    case "error":
    case "fatal":
      return "ERROR";
    case "debug":
    case "trace":
      return "DEBUG";
    default:
      return "INFO";
  }
}

function logClock(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toISOString().slice(11, 23);
}

function firstAttribute(
  attributes: Record<string, string> | undefined,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = attributes?.[key];
    if (value) return value;
  }
  return undefined;
}

export function logFromApi(item: AdminLog): LogEntry {
  const attributes = { ...(item.attributes ?? {}) };
  const resource = item.resource_attributes ?? {};
  const requestId =
    firstAttribute(attributes, [
      "request_id",
      "http.request.id",
      "request.id",
    ]) ?? "—";
  const traceId = item.trace_id ?? "—";
  const statusCode = firstAttribute(attributes, [
    "http.response.status_code",
    "http.status_code",
    "status_code",
  ]);
  const latency = firstAttribute(attributes, [
    "http.response.duration_ms",
    "duration_ms",
    "latency_ms",
  ]);
  return {
    id: [
      item.timestamp,
      item.service,
      item.trace_id ?? "",
      item.span_id ?? "",
      item.message,
    ].join("|"),
    timestampIso: item.timestamp,
    timestamp: logClock(item.timestamp),
    level: normalizeLogLevel(item.level),
    service: item.service,
    environment:
      firstAttribute(resource, [
        "deployment.environment",
        "deployment.environment.name",
        "environment",
      ]) ?? "unknown",
    message: item.message,
    meta: statusCode ?? latency,
    requestId,
    traceId,
    user: firstAttribute(attributes, ["user.id", "account.id", "user"]),
    agentRun: firstAttribute(attributes, ["agent_run.id", "run.id"]),
    attributes: {
      ...attributes,
      ...Object.fromEntries(
        Object.entries(resource).map(([key, value]) => [
          `resource.${key}`,
          value,
        ]),
      ),
    },
  };
}

function normalizeSpanStatus(status: string): SpanStatus {
  return status.toLowerCase().includes("error") ? "error" : "success";
}

export function tracesFromSpans(spans: AdminTraceSpan[]): Trace[] {
  const grouped = new Map<string, AdminTraceSpan[]>();
  for (const span of spans) {
    const current = grouped.get(span.trace_id);
    if (current) current.push(span);
    else grouped.set(span.trace_id, [span]);
  }

  return [...grouped.entries()]
    .map(([traceId, traceSpans]) => {
      const ordered = [...traceSpans].sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      const root = ordered.find((span) => !span.parent_span_id) ?? ordered[0];
      const start = new Date(ordered[0].timestamp).getTime();
      const end = Math.max(
        ...ordered.map(
          (span) =>
            new Date(span.timestamp).getTime() + span.duration_ns / 1_000_000,
        ),
      );
      const spanList: TraceSpan[] = ordered.map((span) => ({
        id: span.span_id,
        name: span.name,
        service: span.service,
        start: Math.max(0, new Date(span.timestamp).getTime() - start),
        duration: Math.max(0, span.duration_ns / 1_000_000),
        status: normalizeSpanStatus(span.status),
      }));
      return {
        trace: {
          id: traceId,
          service: root.service,
          operation: root.name,
          duration: Math.max(0, end - start),
          status: spanList.some((span) => span.status === "error")
            ? ("error" as const)
            : ("success" as const),
          timestamp: logClock(root.timestamp),
          spanList,
        },
        startedAtMs: start,
      };
    })
    .sort((a, b) => b.startedAtMs - a.startedAtMs)
    .map((item) => item.trace);
}

export function providersFromCatalog(
  catalog: components["schemas"]["AgentCatalogResponse"] | undefined,
): ProviderProjection[] {
  return (
    catalog?.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      models: provider.models,
    })) ?? []
  );
}

function countBy<T>(items: T[], key: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function usageFromOperations(
  operations: AdminOperation[],
  summary: AdminOperationSummary | null,
): UsageProjection {
  return {
    summary,
    totalRecent: operations.length,
    byKind: countBy(operations, (item) => item.kind).map(
      ({ value, count }) => ({
        kind: value,
        count,
      }),
    ),
    byStatus: countBy(operations, (item) => item.status).map(
      ({ value, count }) => ({ status: value, count }),
    ),
    recent: operations.slice(0, 20),
  };
}

function incidentDuration(
  startedAt: string,
  resolvedAt: string | null | undefined,
): string {
  const start = new Date(startedAt).getTime();
  const end = resolvedAt ? new Date(resolvedAt).getTime() : Date.now();
  const minutes = Math.max(0, Math.round((end - start) / 60_000));
  const label =
    minutes < 60
      ? `${minutes}m`
      : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return resolvedAt ? label : `Ongoing for ${label}`;
}

function toIncidentUpdate(
  event: components["schemas"]["AdminIncident"]["events"][number],
): IncidentUpdate {
  return {
    time: formatRelative(event.created_at),
    kind: event.kind,
    message: event.message,
  };
}

export function toIncident(
  item: components["schemas"]["AdminIncident"],
): Incident {
  return {
    id: item.id,
    title: item.title,
    severity: item.severity,
    services: item.services,
    status: item.status,
    startedAt: formatRelative(item.started_at),
    duration: incidentDuration(item.started_at, item.resolved_at),
    updates: item.events.map(toIncidentUpdate),
  };
}

export function statusFromApi(
  page: AdminStatusPage | undefined,
  incidents: Incident[],
): StatusProjection {
  const components = page?.components ?? [];
  const degraded =
    incidents.some((incident) => incident.status !== "resolved") ||
    components.some(
      (component) =>
        component.status !== "operational" &&
        component.status !== "maintenance",
    );
  return {
    name: page?.name ?? "Status page",
    description: page?.description ?? "",
    isPublic: page?.is_public ?? false,
    updatedAt: page?.updated_at ?? "",
    components,
    incidents,
    degraded,
  };
}
