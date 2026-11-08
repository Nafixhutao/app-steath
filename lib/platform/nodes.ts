import { createHash, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import { ApiError } from "./api-error.ts";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * A node is considered unhealthy when its last heartbeat is older than this.
 * The Node Agent heartbeats every 30 seconds, so three missed beats means the
 * agent is gone and new Deployments must be blocked.
 */
export const NODE_HEARTBEAT_TIMEOUT_MS = 90_000;

const DEFAULT_NODE_NAME = "node-1";

export type NodeStatus = "unknown" | "healthy" | "unhealthy";

export type NodeSummary = {
  id: string;
  name: string;
  status: NodeStatus;
  lastSeenAt: Date | null;
  capacity: {
    dockerVersion?: string;
    buildkitAvailable?: boolean;
    cpuCount?: number;
    memoryMb?: number;
  };
};

type NodeRow = {
  id: string;
  name: string;
  status: NodeStatus;
  lastSeenAt: Date | null;
  capacity: NodeSummary["capacity"];
};

export function hashNodeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The Node Agent is configured through the environment: the Control Plane needs
 * its private base URL and the shared token, and stores only the token hash.
 */
export function nodeConfig(): { name: string; baseUrl: string; token: string } {
  const token = process.env.AGENT_TOKEN;
  const baseUrl = process.env.AGENT_BASE_URL;

  if (!token || !baseUrl) {
    throw new ApiError(
      503,
      "node_not_configured",
      "The Node Agent is not configured. Set AGENT_BASE_URL and AGENT_TOKEN.",
    );
  }

  return {
    name: process.env.AGENT_NAME ?? DEFAULT_NODE_NAME,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token,
  };
}

/**
 * Records a heartbeat from the Node Agent. The row is created on first contact
 * so a fresh installation only needs environment variables, not a seed script.
 */
export async function recordHeartbeat(input: {
  name: string;
  capacity: NodeSummary["capacity"];
}): Promise<NodeSummary> {
  const config = nodeConfig();

  const result = await pool.query<NodeRow>(
    `INSERT INTO "node" ("id", "name", "baseUrl", "tokenHash", "status", "lastSeenAt", "capacity")
     VALUES (gen_random_uuid()::text, $1, $2, $3, 'healthy', now(), $4::jsonb)
     ON CONFLICT ("name") DO UPDATE
       SET "baseUrl" = EXCLUDED."baseUrl",
           "tokenHash" = EXCLUDED."tokenHash",
           "status" = 'healthy',
           "lastSeenAt" = now(),
           "capacity" = EXCLUDED."capacity"
     RETURNING "id", "name", "status", "lastSeenAt", "capacity"`,
    [input.name, config.baseUrl, hashNodeToken(config.token), JSON.stringify(input.capacity)],
  );

  return toSummary(result.rows[0]);
}

/**
 * Resolves the node that sent a heartbeat. The token is compared by hash, so a
 * stolen database row cannot be replayed as an agent credential. Before the
 * first heartbeat there is no row yet, so the configured token bootstraps it.
 */
export async function authenticateNodeToken(token: string): Promise<{ name: string }> {
  const config = nodeConfig();
  const provided = Buffer.from(hashNodeToken(token), "hex");
  const configured = Buffer.from(hashNodeToken(config.token), "hex");

  if (
    configured.length === provided.length &&
    timingSafeEqual(configured, provided)
  ) {
    return { name: config.name };
  }

  const result = await pool.query<{ name: string; tokenHash: string }>(
    'SELECT "name", "tokenHash" FROM "node"',
  );

  for (const row of result.rows) {
    const expected = Buffer.from(row.tokenHash, "hex");
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
      return { name: row.name };
    }
  }

  throw new ApiError(401, "unauthenticated", "Missing or invalid Node Agent token.");
}

export async function listNodes(): Promise<NodeSummary[]> {
  const result = await pool.query<NodeRow>(
    'SELECT "id", "name", "status", "lastSeenAt", "capacity" FROM "node" ORDER BY "createdAt"',
  );

  return result.rows.map(toSummary);
}

/**
 * Returns the single node, treating a stale heartbeat as unhealthy. The status
 * is derived from `lastSeenAt` instead of trusting the stored value, so a node
 * that dies without saying goodbye still stops receiving work.
 */
export async function getPrimaryNode(): Promise<NodeSummary | null> {
  const nodes = await listNodes();
  return nodes[0] ?? null;
}

/**
 * Blocks a Deployment when no node has reported in recently, because the Build
 * would otherwise sit queued forever with no explanation.
 */
export async function requireHealthyNode(): Promise<NodeSummary> {
  const node = await getPrimaryNode();

  if (!node || node.status !== "healthy") {
    throw new ApiError(
      409,
      "node_unhealthy",
      "No healthy Node Agent is available, so new Deployments are blocked.",
    );
  }

  return node;
}

function toSummary(row: NodeRow): NodeSummary {
  const lastSeenAt = row.lastSeenAt ? new Date(row.lastSeenAt) : null;
  const fresh =
    lastSeenAt !== null && Date.now() - lastSeenAt.getTime() <= NODE_HEARTBEAT_TIMEOUT_MS;

  return {
    id: row.id,
    name: row.name,
    status: row.status === "healthy" && fresh ? "healthy" : "unhealthy",
    lastSeenAt,
    capacity: row.capacity ?? {},
  };
}
