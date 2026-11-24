import { pool } from "./db";
import { isRedisReachable } from "./redis";

/**
 * Admin read projections. Half of the admin API used to embed its SQL in the
 * route handler, which made every projection unreachable from tests and left
 * 23 admin routes untested. The queries and their wire mappings live here now;
 * routes stay thin adapters that parse query strings and call `withAdmin`.
 *
 * Every wire shape mirrors stealth-forge's OpenAPI exactly (snake_case, ISO
 * timestamps), so the ported components render unmodified.
 */

export type ComponentStatus = { name: string; status: string };

export type AdminOverviewPayload = {
  instance_status: "healthy" | "degraded";
  checked_at: string;
  components: ComponentStatus[];
  telemetry: { status: string };
  operations: {
    active_deployments: number;
    queued_jobs: number;
    running_jobs: number;
    failed_jobs: number;
  };
  recent_deployments: {
    id: string;
    app_name: string;
    version: number;
    status: string;
    build_status: string;
    created_at: string;
  }[];
};

/** Recent deployments, newest first, capped like the source query. */
const RECENT_DEPLOYMENTS_LIMIT = 8;

/** A node is stale — and its Agent component unavailable — after two minutes. */
const NODE_STALE_MS = 120_000;

export async function getAdminOverview(): Promise<AdminOverviewPayload> {
  const healthResult = await pool.query<{
    db_ok: boolean;
    node_id: string | null;
    node_name: string | null;
    node_status: string | null;
    node_last_seen: Date | null;
  }>(`
  SELECT
    (SELECT to_regclass('public."user"') IS NOT NULL) AS db_ok,
    n."id" AS node_id, n."name" AS node_name,
    n."status" AS node_status, n."lastSeenAt" AS node_last_seen
  FROM (SELECT 1) one
  LEFT JOIN "node" n ON n."id" = (SELECT "id" FROM "node" ORDER BY "createdAt" LIMIT 1)
`);

  const health = healthResult.rows[0];
  const nodeStale =
    !health.node_last_seen ||
    Date.now() - new Date(health.node_last_seen).getTime() > NODE_STALE_MS;

  const components: ComponentStatus[] = [
    { name: "api", status: "healthy" },
    { name: "postgres", status: health.db_ok ? "healthy" : "unavailable" },
    { name: "redis", status: (await isRedisReachable()) ? "healthy" : "unavailable" },
    {
      name: "agent",
      status:
        health.node_status === "healthy" && !nodeStale
          ? "healthy"
          : health.node_status === "unhealthy" || nodeStale
            ? "unavailable"
            : // The Forge component-status vocabulary has no "degraded";
              // an unseen-but-fresh node reports unknown.
              "unknown",
    },
  ];

  const operationsResult = await pool.query<{
    counts: {
      active_deployments: number;
      queued_jobs: number;
      running_jobs: number;
      failed_jobs: number;
    };
  }>(`
  SELECT jsonb_build_object(
    'active_deployments', (
      SELECT count(*) FROM "deployment" d
      WHERE d."status" IN ('queued', 'building', 'deploying')
    ),
    'queued_jobs', (SELECT count(*) FROM "job" j WHERE j."status" = 'queued'),
    'running_jobs', (SELECT count(*) FROM "job" j WHERE j."status" = 'running'),
    'failed_jobs', (SELECT count(*) FROM "job" j WHERE j."status" = 'failed')
  ) AS counts
`);

  const deploymentsResult = await pool.query<{
    id: string;
    app_name: string;
    version: number;
    status: string;
    build_status: string;
    created_at: Date;
  }>(`
  SELECT d."id",
         s."name" AS app_name,
         (row_number() OVER (PARTITION BY d."serviceId" ORDER BY d."createdAt"))::int AS version,
         d."status",
         CASE WHEN d."imageRef" IS NOT NULL THEN 'succeeded' ELSE 'pending' END AS build_status,
         d."createdAt" AS created_at
  FROM "deployment" d
  JOIN "service" s ON s."id" = d."serviceId"
  ORDER BY d."createdAt" DESC
  LIMIT ${RECENT_DEPLOYMENTS_LIMIT}
`);

  return {
    instance_status: components.every((c) => c.status === "healthy") ? "healthy" : "degraded",
    checked_at: new Date().toISOString(),
    components,
    telemetry: { status: "unavailable" },
    operations: operationsResult.rows[0].counts,
    recent_deployments: deploymentsResult.rows.map((row) => ({
      id: row.id,
      app_name: row.app_name,
      version: row.version,
      status: row.status,
      build_status: row.build_status,
      created_at: row.created_at.toISOString(),
    })),
  };
}

export type StatusPagePayload = {
  name: string;
  description: string;
  is_public: boolean;
  updated_at: string;
  components: ComponentStatus[];
  published_incidents: string[];
};

export async function getAdminStatusPage(): Promise<StatusPagePayload> {
  const healthResult = await pool.query<{
    node_status: string | null;
    node_last_seen: Date | null;
  }>(`
  SELECT n."status" AS "node_status", n."lastSeenAt" AS "node_last_seen"
  FROM "node" n
  ORDER BY n."createdAt"
  LIMIT 1
`);

  const node = healthResult.rows[0];
  const nodeStale =
    !node?.node_last_seen || Date.now() - new Date(node.node_last_seen).getTime() > NODE_STALE_MS;

  const incidentResult = await pool.query<{
    title: string;
    started_at: Date;
  }>(`
  SELECT "title", "startedAt" AS "started_at"
  FROM "admin_incident"
  WHERE "status" <> 'resolved'
  ORDER BY "startedAt" DESC
  LIMIT 20
`);

  const agentHealthy = node?.node_status === "healthy" && !nodeStale;

  return {
    name: "Stealth PaaS",
    description: "Live service health for the Stealth platform control plane.",
    is_public: false,
    updated_at: new Date().toISOString(),
    components: [
      { name: "API", status: "operational" },
      { name: "Database", status: "operational" },
      { name: "Cache", status: (await isRedisReachable()) ? "operational" : "unavailable" },
      {
        name: "Agents",
        status: agentHealthy ? "operational" : "unavailable",
      },
    ],
    // Forge publishes resolved-and-active incident titles on the page; paas
    // lists the currently active ones, which is the honest instance state.
    published_incidents: incidentResult.rows.map((row) => row.title),
  };
}

export type AdminAccountItem = {
  id: string;
  email: string;
  email_verified: boolean;
  plan: string;
  created_at: string;
  providers: string[];
  avatar_url?: string;
  display_name?: string;
  last_sign_in_at?: string;
  last_sign_in_method?: string;
};

export async function listAdminAccounts(): Promise<{ items: AdminAccountItem[] }> {
  const result = await pool.query<{
    id: string;
    email: string;
    email_verified: boolean;
    created_at: Date;
    avatar_url: string | null;
    display_name: string | null;
    last_sign_in_at: Date | null;
    last_sign_in_method: string | null;
    providers: string[];
  }>(`
  SELECT u."id",
         u."email",
         u."emailVerified" AS "email_verified",
         u."createdAt" AS "created_at",
         u."image" AS "avatar_url",
         u."name" AS "display_name",
         (SELECT max(s."createdAt") FROM "session" s
          WHERE s."userId" = u."id") AS "last_sign_in_at",
         -- The newest account row is the provider the account last used.
         (SELECT a."providerId" FROM "account" a
          WHERE a."userId" = u."id"
          ORDER BY a."createdAt" DESC LIMIT 1) AS "last_sign_in_method",
         COALESCE((
           SELECT jsonb_agg(DISTINCT a2."providerId")
           FROM "account" a2
           WHERE a2."userId" = u."id"
             AND a2."providerId" IN ('github', 'google')
         ), '[]'::jsonb) AS providers
  FROM "user" u
  ORDER BY u."createdAt" DESC
  LIMIT 500
`);

  return {
    items: result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      email_verified: row.email_verified,
      // paas has no subscription plan column; every account renders on the
      // Free tier, which is the honest state of this instance.
      plan: "free",
      created_at: row.created_at.toISOString(),
      providers: row.providers ?? [],
      ...(row.avatar_url ? { avatar_url: row.avatar_url } : {}),
      ...(row.display_name ? { display_name: row.display_name } : {}),
      ...(row.last_sign_in_at ? { last_sign_in_at: row.last_sign_in_at.toISOString() } : {}),
      ...(row.last_sign_in_method ? { last_sign_in_method: row.last_sign_in_method } : {}),
    })),
  };
}

export type DbMetricSample = {
  timestamp: string;
  connections: number;
  max_connections: number;
  active_queries: number;
  cache_hit_ratio_known: boolean;
  cache_hit_ratio_percent: number;
  transactions_per_sec: number;
  query_latency_ms: number;
  replication_standbys: number;
  database_size_bytes: number;
  uptime_seconds: number;
};

export type DbMetricsPayload = {
  current: DbMetricSample | null;
  history: DbMetricSample[];
  server_version: string;
  reachable: boolean;
};

const DB_METRICS_MAX_WINDOW_MINUTES = 24 * 60;

export async function getAdminDbMetrics(windowMinutes: number): Promise<DbMetricsPayload> {
  const minutes = Math.min(Math.max(windowMinutes, 1), DB_METRICS_MAX_WINDOW_MINUTES);

  const historyResult = await pool.query<DbMetricSample>(
    `
  SELECT "capturedAt" AS "timestamp", "connections",
         "maxConnections" AS "max_connections",
         "activeQueries" AS "active_queries",
         "cacheHitRatioKnown" AS "cache_hit_ratio_known",
         "cacheHitRatioPercent"::float8 AS "cache_hit_ratio_percent",
         "transactionsPerSec"::float8 AS "transactions_per_sec",
         "queryLatencyMs"::float8 AS "query_latency_ms",
         "replicationStandbys" AS "replication_standbys",
         "databaseSizeBytes"::float8 AS "database_size_bytes",
         "uptimeSeconds"::float8 AS "uptime_seconds"
  FROM "admin_db_metric"
  WHERE "capturedAt" >= now() - ($1 || ' minutes')::interval
  ORDER BY "capturedAt" ASC
  `,
    [String(minutes)],
  );

  // The sampler writes Date objects into the jsonb-typed columns; serialize
  // timestamps to the wire format here so routes stay mapping-free.
  const history = historyResult.rows.map((row) => ({
    ...row,
    timestamp: new Date(row.timestamp).toISOString(),
  }));
  const current = history[history.length - 1] ?? null;

  // "Reachable" means the database answered version(), not that the sampler
  // happened to write a row in this window. An empty history is still honest.
  const versionResult = await pool.query<{ version: string }>("SELECT version() AS version");
  const reachable = versionResult.rows.length > 0;
  const serverVersion = reachable ? (versionResult.rows[0]?.version ?? "") : "";

  return {
    current,
    history,
    server_version: serverVersion,
    reachable,
  };
}

export type HostMetricSample = {
  timestamp: string;
  cpu_percent: number;
  memory_used_bytes: number;
  memory_total_bytes: number;
  disk_used_bytes: number;
  disk_total_bytes: number;
  network_rx_bytes_per_sec: number;
  network_tx_bytes_per_sec: number;
};

export type HostMetricsPayload = {
  current: HostMetricSample | null;
  history: HostMetricSample[];
};

const HOST_METRICS_MAX_WINDOW_MINUTES = 24 * 60;

function mibToBytes(value: number): number {
  return Math.round(value * 1024 * 1024);
}

export async function getAdminHostMetrics(windowMinutes: number): Promise<HostMetricsPayload> {
  const minutes = Math.min(Math.max(windowMinutes, 1), HOST_METRICS_MAX_WINDOW_MINUTES);

  const result = await pool.query<{
    timestamp: Date;
    cpu_percent: number;
    memory_used: number;
    memory_total: number;
    disk_used: number;
    disk_total: number;
  }>(
    `SELECT m."capturedAt" AS "timestamp",
          m."cpuPercent"::float8 AS "cpu_percent",
          m."memoryUsedMb" AS "memory_used",
          m."memoryTotalMb" AS "memory_total",
          m."storageUsedMb" AS "disk_used",
          m."storageTotalMb" AS "disk_total"
   FROM "node_host_metric" m
   WHERE m."nodeId" = (SELECT "id" FROM "node" ORDER BY "createdAt" LIMIT 1)
     AND m."capturedAt" >= now() - ($1 || ' minutes')::interval
   ORDER BY m."capturedAt" ASC`,
    [String(minutes)],
  );

  const history: HostMetricSample[] = result.rows.map((row) => ({
    timestamp: row.timestamp.toISOString(),
    cpu_percent: Number(row.cpu_percent),
    memory_used_bytes: mibToBytes(row.memory_used),
    memory_total_bytes: mibToBytes(row.memory_total),
    disk_used_bytes: mibToBytes(row.disk_used),
    disk_total_bytes: mibToBytes(row.disk_total),
    // The node agent does not sample network counters yet, so the rate is
    // an honest zero and the Network chart renders flat.
    network_rx_bytes_per_sec: 0,
    network_tx_bytes_per_sec: 0,
  }));

  return {
    current: history[history.length - 1] ?? null,
    history,
  };
}

export type RedisMetricSample = {
  timestamp: string;
  connections: number;
  max_clients: number;
  ops_per_sec: number;
  hit_rate_known: boolean;
  hit_rate_percent: number;
  memory_used_bytes: number;
  memory_max_bytes: number;
  keys: number;
  uptime_seconds: number;
};

export type RedisMetricsPayload = {
  current: RedisMetricSample | null;
  history: RedisMetricSample[];
  server_version: string;
  reachable: boolean;
};

const REDIS_METRICS_MAX_WINDOW_MINUTES = 24 * 60;

export async function getAdminRedisMetrics(windowMinutes: number): Promise<RedisMetricsPayload> {
  const minutes = Math.min(Math.max(windowMinutes, 1), REDIS_METRICS_MAX_WINDOW_MINUTES);

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return {
      current: null,
      history: [],
      server_version: "",
      reachable: false,
    };
  }

  const historyResult = await pool.query<RedisMetricSample>(
    `
  SELECT "capturedAt" AS "timestamp", "connections",
         "maxClients" AS "max_clients",
         "opsPerSec"::float8 AS "ops_per_sec",
         "hitRateKnown" AS "hit_rate_known",
         "hitRatePercent"::float8 AS "hit_rate_percent",
         "memoryUsedBytes"::float8 AS "memory_used_bytes",
         "memoryMaxBytes"::float8 AS "memory_max_bytes",
         "keys", "uptimeSeconds"::float8 AS "uptime_seconds"
  FROM "admin_redis_metric"
  WHERE "capturedAt" >= now() - ($1 || ' minutes')::interval
  ORDER BY "capturedAt" ASC
  `,
    [String(minutes)],
  );

  const history = historyResult.rows.map((row) => ({
    ...row,
    timestamp: new Date(row.timestamp).toISOString(),
  }));

  return {
    current: history[history.length - 1] ?? null,
    history,
    server_version: "",
    reachable: history.length > 0,
  };
}
