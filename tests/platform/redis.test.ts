import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { prepareTestDatabase } from "../helpers/database";
import { createRedisClient, isRedisReachable } from "@/lib/platform/redis";

/**
 * The Redis helper against a real Redis (the CI service or a scratch
 * container): reachability, the sampler's wire shape, and the unreachable
 * path when REDIS_URL is absent. The sampler is imported dynamically inside
 * its test so the db pool binds after `prepareTestDatabase` has pointed
 * DATABASE_URL at the scratch database.
 */

let pool: Pool;

beforeAll(async () => {
  await prepareTestDatabase();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});

afterAll(async () => {
  if (pool) {
    await pool.end();
  }
});

describe("isRedisReachable", () => {
  it("answers true against a live Redis", async () => {
    // The CI workflow (and the scratch run) always sets TEST_REDIS_URL.
    process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
    expect(await isRedisReachable()).toBe(true);
  });

  it("answers false when REDIS_URL is absent", async () => {
    delete process.env.REDIS_URL;
    expect(await isRedisReachable()).toBe(false);
  });

  it("answers false when the URL points nowhere", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:1";
    expect(await isRedisReachable()).toBe(false);
  });
});

describe("recordAdminRedisMetrics", () => {
  it("stores one INFO snapshot in the Forge wire shape", async () => {
    process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
    const { recordAdminRedisMetrics } = await import("@/lib/platform/admin-metrics");

    await recordAdminRedisMetrics();

    const result = await pool.query<{
      connections: number;
      max_clients: number;
      hit_rate_known: boolean;
      hit_rate_percent: string;
      memory_max_bytes: number;
      keys: string;
      uptime_seconds: string;
    }>(`SELECT "connections", "maxClients" AS "max_clients",
               "hitRateKnown" AS "hit_rate_known", "hitRatePercent" AS "hit_rate_percent",
               "memoryMaxBytes" AS "memory_max_bytes",
               "keys", "uptimeSeconds" AS "uptime_seconds"
        FROM "admin_redis_metric"
        WHERE "capturedAt" >= now() - interval '1 minute'`);

    expect(result.rowCount).toBeGreaterThan(0);
    const sample = result.rows[0];
    expect(sample.connections).toBeGreaterThan(0);
    expect(sample.max_clients).toBeGreaterThan(0);
    // numeric columns come back as strings; assert on the coerced value.
    expect(Number(sample.uptime_seconds)).toBeGreaterThan(0);
    // The sampler does not derive hit rates yet: the honest defaults, as
    // numeric strings for the decimal columns.
    expect(sample.hit_rate_known).toBe(false);
    expect(Number(sample.hit_rate_percent)).toBe(0);
    expect(Number(sample.keys)).toBeGreaterThanOrEqual(0);
  });

  it("is a no-op without REDIS_URL", async () => {
    delete process.env.REDIS_URL;
    const { recordAdminRedisMetrics } = await import("@/lib/platform/admin-metrics");

    const before = await pool.query<{ count: string }>(`SELECT count(*) FROM "admin_redis_metric"`);

    await recordAdminRedisMetrics();

    const after = await pool.query<{ count: string }>(`SELECT count(*) FROM "admin_redis_metric"`);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
});

describe("createRedisClient", () => {
  it("gives up fast instead of hanging on a dead URL", () => {
    const client = createRedisClient("redis://127.0.0.1:1");
    expect(client.options?.lazyConnect).toBe(true);
    expect(client.options?.maxRetriesPerRequest).toBe(0);
    client.disconnect();
  });
});
