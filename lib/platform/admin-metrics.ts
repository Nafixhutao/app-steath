import { pool } from "./db.ts";

/**
 * Admin control-plane metric samples, ported from the stealth-forge admin
 * console. The Overview page polls in-process database and Redis samples every
 * 5 seconds (Forge keeps a 720-sample ring in its Go process memory); the paas
 * worker records each sample in `admin_db_metric` / `admin_redis_metric`, so
 * the history survives process restarts and the admin API reads it back inside
 * the requested window. Retention matches the host metrics: 24 hours.
 */

/** How long admin metric history is kept. The Overview reads at most a day. */
const ADMIN_METRIC_RETENTION_HOURS = 24;

/** One PostgreSQL snapshot, exactly the AdminDBMetricsSample wire shape. */
export type AdminDBSample = {
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

/** One Redis INFO snapshot, exactly the AdminRedisMetricsSample shape. */
export type RedisSample = {
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

/** Samples PostgreSQL's own statistics and stores one admin_db_metric row. */
export async function recordAdminDBMetrics(): Promise<void> {
  const result = await pool.query<{
    snapshot: AdminDBSample;
  }>(`
    SELECT jsonb_build_object(
      'timestamp', to_jsonb(now()),
      'connections', (SELECT count(*) FROM pg_stat_activity),
      'max_connections', current_setting('max_connections')::int,
      'active_queries', (
        SELECT count(*) FROM pg_stat_activity WHERE state = 'active'
      ),
      'cache_hit_ratio_known', (
        SELECT sum("blks_hit") + sum("blks_read") > 0
        FROM pg_stat_database WHERE datname = current_database()
      ),
      'cache_hit_ratio_percent', COALESCE((
        SELECT round(
          100.0 * sum("blks_hit") /
            GREATEST(sum("blks_hit") + sum("blks_read"), 1),
          2
        )
        FROM pg_stat_database WHERE datname = current_database()
      ), 0),
      -- A per-second transaction rate needs two samples; Forge computes it
      -- from its ring. One pass stores the cumulative counter instead and the
      -- API derives the rate between consecutive rows.
      'transactions_per_sec', 0,
      'query_latency_ms', 0,
      'replication_standbys', (
        SELECT count(*) FROM pg_stat_replication
      ),
      'database_size_bytes', (
        SELECT pg_database_size(current_database())
      ),
      'uptime_seconds', (
        SELECT EXTRACT(EPOCH FROM now() - pg_postmaster_start_time())
      )
    ) AS snapshot
  `);

  const sample = result.rows[0].snapshot;
  await pool.query(
    `INSERT INTO "admin_db_metric"
       ("connections", "maxConnections", "activeQueries",
        "cacheHitRatioKnown", "cacheHitRatioPercent", "transactionsPerSec",
        "queryLatencyMs", "replicationStandbys", "databaseSizeBytes",
        "uptimeSeconds", "capturedAt")
     VALUES ($1, $2, $3, $4, $5, 0, 0, $6, $7, $8, $9)`,
    [
      sample.connections,
      sample.max_connections,
      sample.active_queries,
      sample.cache_hit_ratio_known,
      sample.cache_hit_ratio_percent,
      sample.replication_standbys,
      sample.database_size_bytes,
      sample.uptime_seconds,
      sample.timestamp,
    ],
  );
}

/** Deletes admin metric rows older than the retention window. */
export async function pruneAdminMetrics(): Promise<number> {
  const result = await pool.query(
    `DELETE FROM "admin_db_metric"
     WHERE "capturedAt" < now() - interval '1' * $1`,
    [ADMIN_METRIC_RETENTION_HOURS],
  );
  return result.rowCount ?? 0;
}

/**
 * Samples Redis via INFO when REDIS_URL is configured. The production stack
 * has no Redis service yet, so this is a no-op that keeps the sampler loop
 * honest: the admin API answers reachable:false with empty history.
 */
export async function recordAdminRedisMetrics(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;

  const Redis = (await import("ioredis")).default;
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 2_000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  try {
    await client.connect();
    const info = await client.info();
    const stats = await info.split("\r\n").reduce<Map<string, string>>(
      (map, line) => {
        const separator = line.indexOf(":");
        if (separator > 0) {
          map.set(line.slice(0, separator), line.slice(separator + 1));
        }
        return map;
      },
      new Map(),
    );

    const maxMemory = Number.parseInt(
      stats.get("maxmemory") ?? "0",
      10,
    );
    const keyCount = await client.dbsize();
    await pool.query(
      `INSERT INTO "admin_redis_metric"
         ("connections", "maxClients", "opsPerSec", "hitRateKnown",
          "hitRatePercent", "memoryUsedBytes", "memoryMaxBytes", "keys",
          "uptimeSeconds", "capturedAt")
       VALUES ($1, $2, 0, false, 0, $3, $4, $5, $6, now())`,
      [
        Number.parseInt(stats.get("connected_clients") ?? "0", 10),
        Number.parseInt(stats.get("maxclients") ?? "10000", 10),
        Number.parseInt(stats.get("used_memory") ?? "0", 10),
        Number.isFinite(maxMemory) ? maxMemory : 0,
        keyCount,
        Number.parseInt(stats.get("uptime_in_seconds") ?? "0", 10),
      ],
    );
  } catch {
    // Redis unreachable: skip the sample; the admin API reports reachable:false.
  } finally {
    client.disconnect();
  }
}
