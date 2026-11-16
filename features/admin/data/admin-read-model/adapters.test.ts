import { describe, expect, it } from "vitest";
import { AdminStatusPageComponentStatus } from "@/lib/admin/api-schema";
import type {
  AdminHostMetricsSnapshot,
  AdminLog,
  AdminOperation,
  AdminTraceSpan,
} from "./types";
import {
  executionQueueFromOperations,
  hostFromMetrics,
  logFromApi,
  resourceSeriesFromMetrics,
  statusFromApi,
  tracesFromSpans,
  usageFromOperations,
} from "./adapters";

const GIB = 1024 ** 3;

const hostSnapshot: AdminHostMetricsSnapshot = {
  current: {
    timestamp: "2026-10-21T10:00:00.000Z",
    cpu_percent: 37.4,
    memory_used_bytes: 8 * GIB,
    memory_total_bytes: 16 * GIB,
    disk_used_bytes: 100 * GIB,
    disk_total_bytes: 200 * GIB,
    network_rx_bytes_per_sec: 2 * 1024 ** 2,
    network_tx_bytes_per_sec: 1024 ** 2,
  },
  history: [
    {
      timestamp: "2026-10-21T09:59:00.000Z",
      cpu_percent: 20,
      memory_used_bytes: 7 * GIB,
      memory_total_bytes: 16 * GIB,
      disk_used_bytes: 99 * GIB,
      disk_total_bytes: 200 * GIB,
      network_rx_bytes_per_sec: 1024 ** 2,
      network_tx_bytes_per_sec: 1024 ** 2,
    },
    {
      timestamp: "2026-10-21T10:00:00.000Z",
      cpu_percent: 37.4,
      memory_used_bytes: 8 * GIB,
      memory_total_bytes: 16 * GIB,
      disk_used_bytes: 100 * GIB,
      disk_total_bytes: 200 * GIB,
      network_rx_bytes_per_sec: 2 * 1024 ** 2,
      network_tx_bytes_per_sec: 1024 ** 2,
    },
  ],
};

function operation(
  id: string,
  status: string,
  kind = "agent_run",
): AdminOperation {
  return {
    id,
    kind: kind as AdminOperation["kind"],
    name: `agent-${id}`,
    project_id: "project-1",
    project_name: "stealth",
    status,
    started_at: "2026-10-21T09:00:00.000Z",
    finished_at: "2026-10-21T09:00:02.000Z",
    duration_ms: 2_000,
    error: null,
    created_at: "2026-10-21T09:00:00.000Z",
  };
}

describe("admin read model adapters", () => {
  it("projects the API host snapshot without inventing fleet members", () => {
    const host = hostFromMetrics(hostSnapshot, 3);
    expect(host).toMatchObject({
      id: "api-host",
      name: "API host",
      cpu: 37,
      memory: 50,
      storage: 50,
      memoryTotalGb: 16,
      storageTotalGb: 200,
      jobs: 3,
    });
  });

  it("builds four resource series from the same host history", () => {
    const series = resourceSeriesFromMetrics(hostSnapshot);
    expect(series.map((item) => item.id)).toEqual([
      "cpu",
      "memory",
      "disk",
      "network",
    ]);
    expect(series.find((item) => item.id === "network")?.current).toBe(
      "3 MB/s",
    );
  });

  it("groups spans by trace ID and keeps the root span as the trace identity", () => {
    const spans: AdminTraceSpan[] = [
      {
        timestamp: "2026-10-21T10:00:00.000Z",
        trace_id: "trace-1",
        span_id: "root",
        name: "GET /v1/projects",
        kind: "server",
        service: "api",
        duration_ns: 120_000_000,
        status: "ok",
      },
      {
        timestamp: "2026-10-21T10:00:00.020Z",
        trace_id: "trace-1",
        span_id: "db",
        parent_span_id: "root",
        name: "SELECT projects",
        kind: "client",
        service: "postgres",
        duration_ns: 30_000_000,
        status: "error",
      },
    ];

    const traces = tracesFromSpans(spans);
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      id: "trace-1",
      service: "api",
      operation: "GET /v1/projects",
      duration: 120,
      status: "error",
    });
    expect(traces[0].spanList.map((span) => span.id)).toEqual(["root", "db"]);
  });

  it("maps redacted log attributes into the explorer model", () => {
    const log: AdminLog = {
      timestamp: "2026-10-21T10:11:12.345Z",
      trace_id: "trace-1",
      span_id: "span-1",
      level: "warn",
      service: "api",
      message: "request slowed",
      attributes: {
        "request.id": "req-1",
        "http.response.status_code": "200",
      },
      resource_attributes: {
        "deployment.environment": "production",
      },
    };

    expect(logFromApi(log)).toMatchObject({
      timestampIso: "2026-10-21T10:11:12.345Z",
      timestamp: "10:11:12.345",
      level: "WARN",
      service: "api",
      environment: "production",
      requestId: "req-1",
      traceId: "trace-1",
      meta: "200",
    });
  });

  it("sorts logs across days by their full timestamp", () => {
    const entries = [
      {
        timestampIso: "2026-10-21T03:01:04.306Z",
        timestamp: "03:01:04.306",
      },
      {
        timestampIso: "2026-10-20T11:10:03.555Z",
        timestamp: "11:10:03.555",
      },
    ];
    entries.sort((a, b) => b.timestampIso.localeCompare(a.timestampIso));
    expect(entries.map((entry) => entry.timestampIso)).toEqual([
      "2026-10-21T03:01:04.306Z",
      "2026-10-20T11:10:03.555Z",
    ]);
  });

  it("uses durable summary counts for the execution queue", () => {
    const queue = executionQueueFromOperations(
      [operation("1", "queued"), operation("2", "failed")],
      {
        active_deployments: 2,
        queued_jobs: 9,
        running_jobs: 4,
        failed_jobs: 1,
      },
    );
    expect(queue).toMatchObject({ queued: 9, running: 4, failed: 1 });
  });

  it("aggregates usage by kind and status from the bounded operation list", () => {
    const usage = usageFromOperations(
      [
        operation("1", "queued"),
        operation("2", "queued"),
        operation("3", "failed", "site_deployment"),
      ],
      null,
    );
    expect(usage.totalRecent).toBe(3);
    expect(usage.byKind).toEqual([
      { kind: "agent_run", count: 2 },
      { kind: "site_deployment", count: 1 },
    ]);
    expect(usage.byStatus).toEqual([
      { status: "queued", count: 2 },
      { status: "failed", count: 1 },
    ]);
  });

  it("marks the status page degraded from current component state", () => {
    const status = statusFromApi(
      {
        name: "Stealth",
        description: "Platform status",
        is_public: true,
        components: [
          {
            name: "API",
            status: AdminStatusPageComponentStatus.major_outage,
          },
          {
            name: "Console",
            status: AdminStatusPageComponentStatus.operational,
          },
        ],
        published_incidents: [],
        updated_at: "2026-10-21T10:00:00.000Z",
      },
      [],
    );
    expect(status.degraded).toBe(true);
  });
});
