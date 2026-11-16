"use client";

import { useMemo } from "react";
import {
  POLL_FAST_MS,
  POLL_MEDIUM_MS,
  POLL_SLOW_MS,
  usePolledQuery,
  type AdminQuery,
} from "./queries";
import {
  cpuHistoryFromMetrics,
  executionQueueFromOperations,
  hostFromMetrics,
  logFromApi,
  providersFromCatalog,
  resourceSeriesFromMetrics,
  runFromOperation,
  statusFromApi,
  toIncident,
  tracesFromSpans,
  usageFromOperations,
} from "./adapters";
import type {
  AdminAPIMetrics,
  AdminAgentCatalog,
  AdminDBMetricsSnapshot,
  AdminErrorGroup,
  AdminErrorGroupsResponse,
  AdminHostMetricsSnapshot,
  AdminLogsResponse,
  AdminOperationSummary,
  AdminOperationsResponse,
  AdminOverviewResponse,
  AdminRedisMetricsSnapshot,
  AdminStatusPage,
  AdminAccountsResponse,
  AdminIncidentsResponse,
  AdminTracesResponse,
  AdminOAuthProvidersResponse,
} from "@/lib/admin/api-schema";
import type {
  AdminReadState,
  AdminReadStatus,
  AdminTimeRange,
  HostTimeRange,
  ExecutionQueueProjection,
  ProviderReadModel,
  RunProjection,
  StatusProjection,
  UsageProjection,
} from "./types";
import type { LogEntry } from "../../types/logs";
import type { Trace } from "../../types/traces";
import type { Incident } from "../../types/incidents";

/**
 * Admin read model — the same projections stealth-forge's
 * `data/admin-read-model` builds, over the paas admin endpoints. The Forge
 * adapters (hostFromMetrics, resourceSeriesFromMetrics, toIncident, …) are
 * reused verbatim from `./adapters`; only the query plumbing differs (plain
 * polled fetch instead of the TanStack cache).
 */

export type {
  AdminErrorGroup,
  AdminOperation,
  AdminOperationSummary,
  AdminReadState,
  AdminReadStatus,
  AdminTimeRange,
  HostTimeRange,
  ExecutionQueueProjection,
  ProviderProjection,
  ProviderReadModel,
  RunProjection,
  StatusProjection,
  UsageProjection,
} from "./types";

const RANGE_MS: Record<AdminTimeRange, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

const HOST_RANGE_MINUTES: Record<HostTimeRange, number> = {
  "5m": 5,
  "15m": 15,
  "1h": 60,
};

function windowFor(range: AdminTimeRange) {
  const to = new Date();
  const from = new Date(to.getTime() - RANGE_MS[range]);
  return { from: from.toISOString(), to: to.toISOString() };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "The Admin API request failed.";
}

function readState<T>(
  queries: AdminQuery<unknown>[],
  data: T,
  refetch: () => void,
): AdminReadState<T> {
  const failed = queries.find((query) => query.isError);
  const status: AdminReadStatus = failed
    ? "error"
    : queries.some((query) => query.isPending)
      ? "pending"
      : "ready";
  return {
    status,
    data,
    error: failed ? errorMessage(failed.error) : null,
    isFetching: queries.some((query) => query.isFetching),
    refetch,
  };
}

function refetchAll(queries: AdminQuery<unknown>[]) {
  return () => {
    for (const query of queries) void query.refetch();
  };
}

function useSecondaryReadState<T>(
  required: AdminQuery<unknown>,
  optional: AdminQuery<unknown>[],
  data: T,
): AdminReadState<T> {
  const queries = [required, ...optional];
  return {
    status: required.isError
      ? "error"
      : required.isPending
        ? "pending"
        : "ready",
    data,
    error: required.isError ? errorMessage(required.error) : null,
    isFetching: queries.some((query) => query.isFetching),
    refetch: refetchAll(queries),
  };
}

function useAdminOverviewQuery() {
  return usePolledQuery<AdminOverviewResponse>(
    "/api/admin/overview",
    POLL_SLOW_MS,
    true,
  );
}

function useOperationsQuery(range: AdminTimeRange, limit: number) {
  const params = new URLSearchParams({ limit: String(limit) });
  const window = windowFor(range);
  params.set("from", window.from);
  params.set("to", window.to);
  return usePolledQuery<AdminOperationsResponse>(
    `/api/admin/operations?${params.toString()}`,
    15_000,
    true,
  );
}

export function useAdminOverview(options?: {
  refetchInterval?: number | false;
}) {
  return usePolledQuery<AdminOverviewResponse>(
    "/api/admin/overview",
    options?.refetchInterval ?? POLL_SLOW_MS,
    true,
  );
}

/** Host metrics, narrowed to `windowMinutes` of retained history. */
export function useAdminHostMetrics(
  windowMinutes?: number,
  options?: { refetchInterval?: number | false },
) {
  const suffix = windowMinutes ? `?window_minutes=${windowMinutes}` : "";
  return usePolledQuery<AdminHostMetricsSnapshot>(
    `/api/admin/host-metrics${suffix}`,
    options?.refetchInterval ?? POLL_FAST_MS,
    true,
  );
}

export function useAdminDBMetrics(windowMinutes?: number) {
  const suffix = windowMinutes ? `?window_minutes=${windowMinutes}` : "";
  return usePolledQuery<AdminDBMetricsSnapshot>(
    `/api/admin/db-metrics${suffix}`,
    POLL_FAST_MS,
    true,
  );
}

export function useAdminRedisMetrics(windowMinutes?: number) {
  const suffix = windowMinutes ? `?window_minutes=${windowMinutes}` : "";
  return usePolledQuery<AdminRedisMetricsSnapshot>(
    `/api/admin/redis-metrics${suffix}`,
    POLL_FAST_MS,
    true,
  );
}

export function useAdminAPIMetrics(options?: {
  refetchInterval?: number | false;
}) {
  return usePolledQuery<AdminAPIMetrics>(
    "/api/admin/api-metrics",
    options?.refetchInterval ?? POLL_MEDIUM_MS,
    true,
  );
}

export function useAdminAccounts(options?: {
  refetchInterval?: number | false;
}) {
  return usePolledQuery<AdminAccountsResponse>(
    "/api/admin/accounts",
    options?.refetchInterval ?? POLL_SLOW_MS,
    true,
  );
}

export function useAdminIncidents(
  query: { limit?: number } = {},
  options?: { refetchInterval?: number | false },
) {
  const suffix = query.limit ? `?limit=${query.limit}` : "";
  return usePolledQuery<AdminIncidentsResponse>(
    `/api/admin/incidents${suffix}`,
    options?.refetchInterval ?? false,
    true,
  );
}

export function useAdminLogTail(
  query: {
    from: string;
    to: string;
    service?: string;
    level?: string;
    query?: string;
  } & { limit?: number },
  enabled: boolean,
): {
  items: AdminLogsResponse["items"];
  error: string | null;
  connected: boolean;
} {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const polled = usePolledQuery<AdminLogsResponse>(
    `/api/admin/telemetry/logs?${params.toString()}`,
    enabled ? POLL_FAST_MS : false,
    true,
  );
  return {
    items: polled.data?.items ?? [],
    error: polled.error?.message ?? null,
    connected: !polled.isError,
  };
}

function useLogsBaseQuery(options: {
  range: AdminTimeRange;
  service?: string;
  level?: string;
  search?: string;
  enabled: boolean;
}) {
  const params = new URLSearchParams({ limit: "250" });
  const window = windowFor(options.range);
  params.set("from", window.from);
  params.set("to", window.to);
  if (options.service) params.set("service", options.service);
  if (options.level) params.set("level", options.level);
  if (options.search) params.set("query", options.search);
  return usePolledQuery<AdminLogsResponse>(
    `/api/admin/telemetry/logs?${params.toString()}`,
    options.enabled ? 30_000 : false,
    true,
  );
}

function useTracesQuery(range: AdminTimeRange) {
  const params = new URLSearchParams({ limit: "250" });
  const window = windowFor(range);
  params.set("from", window.from);
  params.set("to", window.to);
  return usePolledQuery<AdminTracesResponse>(
    `/api/admin/telemetry/traces?${params.toString()}`,
    15_000,
    true,
  );
}

function useErrorsQuery(range: AdminTimeRange) {
  const params = new URLSearchParams({ limit: "250" });
  const window = windowFor(range);
  params.set("from", window.from);
  params.set("to", window.to);
  return usePolledQuery<AdminErrorGroupsResponse>(
    `/api/admin/telemetry/errors?${params.toString()}`,
    POLL_SLOW_MS,
    true,
  );
}

function useStatusPageQuery() {
  return usePolledQuery<AdminStatusPage>(
    "/api/admin/status-page",
    POLL_SLOW_MS,
    true,
  );
}

function useAgentCatalogQuery() {
  return usePolledQuery<AdminAgentCatalog>(
    "/api/admin/agent-catalog",
    false,
    true,
  );
}

export function useInfrastructureReadModel(
  range: HostTimeRange = "1h",
): AdminReadState<{
  host: ReturnType<typeof hostFromMetrics>;
  series: ReturnType<typeof resourceSeriesFromMetrics>;
  cpuHistory: number[];
  snapshot: AdminHostMetricsSnapshot | undefined;
  operations: AdminOperationSummary | undefined;
}> {
  // Keyed by the minutes actually sent, not by the range label, so this shares
  // a cache entry with the Overview page instead of polling the same URL twice
  // under two different keys.
  const host = useAdminHostMetrics(HOST_RANGE_MINUTES[range]);
  const overview = useAdminOverviewQuery();
  const snapshot = host.data;
  const operations = overview.data?.operations;
  const queries = [host, overview];
  const data = {
    host: hostFromMetrics(snapshot, operations?.running_jobs),
    series: resourceSeriesFromMetrics(snapshot),
    cpuHistory: cpuHistoryFromMetrics(snapshot),
    snapshot,
    operations,
  };
  return readState(queries, data, refetchAll(queries));
}

export function useExecutionQueueReadModel(): AdminReadState<ExecutionQueueProjection> {
  const operations = useOperationsQuery("24h", 100);
  const overview = useAdminOverviewQuery();
  const data = executionQueueFromOperations(
    operations.data?.items ?? [],
    overview.data?.operations ?? null,
  );
  return useSecondaryReadState(operations, [overview], data);
}

export function useRunsReadModel(
  range: AdminTimeRange = "7d",
): AdminReadState<RunProjection[]> {
  const operations = useOperationsQuery(range, 100);
  const data = useMemo(
    () =>
      (operations.data?.items ?? [])
        .filter((item) => item.kind === "agent_run")
        .map(runFromOperation),
    [operations.data],
  );
  return readState([operations], data, refetchAll([operations]));
}

export function useLogsReadModel(options: {
  range: AdminTimeRange;
  service?: string;
  level?: string;
  search?: string;
  live: boolean;
}): AdminReadState<LogEntry[]> {
  const { range, service, level, search, live } = options;
  const base = useLogsBaseQuery({
    range,
    service,
    level,
    search,
    enabled: !live,
  });
  const tailWindow = useMemo(() => windowFor(range), [range]);
  const tail = useAdminLogTail(
    {
      ...tailWindow,
      service,
      level,
      query: search,
      limit: 250,
    },
    live,
  );
  const data = useMemo(() => {
    const merged = new Map<string, LogEntry>();
    for (const item of tail.items) {
      const entry = logFromApi(item);
      merged.set(entry.id, entry);
    }
    for (const item of base.data?.items ?? []) {
      const entry = logFromApi(item);
      merged.set(entry.id, entry);
    }
    return [...merged.values()].sort((a, b) =>
      b.timestampIso.localeCompare(a.timestampIso),
    );
  }, [base.data, tail.items]);
  const tailError = tail.error ? new Error(tail.error) : null;
  return {
    status: tailError
      ? "error"
      : base.isPending && !live
        ? "pending"
        : "ready",
    data,
    error: tailError
      ? errorMessage(tailError)
      : base.error
        ? errorMessage(base.error)
        : null,
    isFetching: base.isFetching,
    refetch: () => void base.refetch(),
  };
}

export function useTracesReadModel(
  range: AdminTimeRange = "1h",
): AdminReadState<Trace[]> {
  const traces = useTracesQuery(range);
  const overview = useAdminOverviewQuery();
  const data = useMemo(
    () => tracesFromSpans(traces.data?.items ?? []),
    [traces.data],
  );
  return useSecondaryReadState(traces, [overview], data);
}

export function useTraceMetrics() {
  const overview = useAdminOverviewQuery();
  return {
    http: overview.data?.http,
    isPending: overview.isPending,
    error: overview.error,
  };
}

export function useErrorsReadModel(
  range: AdminTimeRange = "24h",
): AdminReadState<AdminErrorGroup[]> {
  const errors = useErrorsQuery(range);
  const data = useMemo(() => errors.data?.items ?? [], [errors.data]);
  return readState([errors], data, refetchAll([errors]));
}

export function useProvidersReadModel(): AdminReadState<ProviderReadModel> {
  const catalog = useAgentCatalogQuery();
  const data = useMemo(
    () => ({
      providers: providersFromCatalog(catalog.data),
      execution: catalog.data?.execution ?? null,
    }),
    [catalog.data],
  );
  return readState([catalog], data, refetchAll([catalog]));
}

export function useUsageReadModel(
  range: AdminTimeRange = "7d",
): AdminReadState<UsageProjection> {
  const operations = useOperationsQuery(range, 100);
  const overview = useAdminOverviewQuery();
  const data = usageFromOperations(
    operations.data?.items ?? [],
    overview.data?.operations ?? null,
  );
  return useSecondaryReadState(operations, [overview], data);
}

export function useStatusReadModel(): AdminReadState<StatusProjection> {
  const status = useStatusPageQuery();
  const incidents = useAdminIncidents(
    { limit: 20 },
    { refetchInterval: 30_000 },
  );
  const data = useMemo(
    () =>
      statusFromApi(
        status.data,
        (incidents.data?.items ?? []).map(toIncident),
      ),
    [incidents.data, status.data],
  );
  return readState([status, incidents], data, refetchAll([status, incidents]));
}

export function useIncidentsReadModel(): AdminReadState<Incident[]> {
  const incidents = useAdminIncidents(
    { limit: 100 },
    { refetchInterval: 30_000 },
  );
  const data = useMemo(
    () => (incidents.data?.items ?? []).map(toIncident),
    [incidents.data],
  );
  return readState([incidents], data, refetchAll([incidents]));
}

export {
  cpuHistoryFromMetrics,
  executionQueueFromOperations,
  hostFromMetrics,
  logFromApi,
  providersFromCatalog,
  resourceSeriesFromMetrics,
  runFromOperation,
  statusFromApi,
  toIncident,
  tracesFromSpans,
  usageFromOperations,
};

/** External sign-in provider status for the admin Settings panel. */
export function useAdminOAuthProviders() {
  return usePolledQuery<AdminOAuthProvidersResponse>(
    "/api/admin/oauth-providers",
    POLL_SLOW_MS,
    true,
  );
}
