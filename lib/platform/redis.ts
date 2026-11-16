import Redis from "ioredis";

/**
 * The control plane's Redis connection helper. Redis is optional in this
 * stack: without `REDIS_URL` every consumer answers its honest unavailable
 * state, and with one the same short-lived client settings apply everywhere —
 * lazy connect, a two-second timeout, and no retries, so a down Redis costs
 * a request its failure and never a hang.
 */

/** Connects lazily and gives up fast; callers own the disconnect. */
export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    connectTimeout: 2_000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
}

/** Without REDIS_URL the stack has no cache, and that is the honest answer. */
export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}

/**
 * Probes the configured Redis with a PING. Unconfigured or unreachable both
 * resolve to `false` — the Overview and Status Page render their unavailable
 * component either way.
 */
export async function isRedisReachable(): Promise<boolean> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return false;

  const client = createRedisClient(redisUrl);
  try {
    await client.connect();
    return (await client.ping()) === "PONG";
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}
