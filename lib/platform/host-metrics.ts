import { pool } from "./db.ts";
import { nodeAgent } from "./node-agent.ts";

/**
 * Node host metrics. The Platform Admin host dashboard shows how loaded each
 * node itself is, which no Service usage snapshot records: the Agent samples
 * the kernel (`/proc/stat`, `/proc/meminfo`, statfs) in the background and
 * answers `/v1/host-metrics` with the latest sample plus short in-memory
 * history. The worker asks each node once per collection pass and stores one
 * row per sample, so the dashboard keeps history even when an agent restarts.
 */

/** How long host metric history is kept. The dashboard reads at most a day. */
const HOST_METRIC_RETENTION_HOURS = 24;

export type NodeHostSample = {
  capturedAt: string;
  cpuPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  storageUsedMb: number;
  storageTotalMb: number;
};

type NodeEndpointRow = {
  id: string;
  name: string;
  baseUrl: string;
};

/**
 * Asks every node with a known endpoint for its host snapshot and stores the
 * current sample of each. A node that cannot be reached is skipped with a log,
 * not an error: a dead node shows up on the dashboard as missing, and the next
 * pass retries.
 */
export async function recordNodeHostMetrics(): Promise<number> {
  const nodes = await pool.query<NodeEndpointRow>(
    'SELECT "id", "name", "baseUrl" FROM "node" WHERE "baseUrl" IS NOT NULL ORDER BY "createdAt"',
  );

  let stored = 0;
  for (const node of nodes.rows) {
    const sample = await fetchNodeHostSample(node);
    if (!sample) {
      continue;
    }

    await pool.query(
      `INSERT INTO "node_host_metric"
         ("nodeId", "cpuPercent", "memoryUsedMb", "memoryTotalMb", "storageUsedMb", "storageTotalMb", "capturedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        node.id,
        sample.cpuPercent,
        sample.memoryUsedMb,
        sample.memoryTotalMb,
        sample.storageUsedMb,
        sample.storageTotalMb,
        sample.capturedAt,
      ],
    );
    stored++;
  }

  return stored;
}

/** Deletes host metric rows older than the retention window. */
export async function pruneNodeHostMetrics(): Promise<number> {
  const result = await pool.query(
    `DELETE FROM "node_host_metric" WHERE "capturedAt" < now() - make_interval(hours => $1)`,
    [HOST_METRIC_RETENTION_HOURS],
  );

  return result.rowCount ?? 0;
}

/** One stored sample of a node's own resource usage, as the worker writes it. */
export type HostMetricNodeSample = {
  capturedAt: string;
  cpuPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  storageUsedMb: number;
  storageTotalMb: number;
};

export type HostMetricNodeReport = {
  id: string;
  name: string;
  status: string;
  lastSeenAt: string | null;
  current: HostMetricNodeSample | null;
  history: HostMetricNodeSample[];
};

type GroupedMetricRow = {
  nodeId: string;
  nodeName: string;
  nodeStatus: string;
  lastSeenAt: Date | null;
} & (
  | {
      capturedAt: Date;
      cpuPercent: string;
      memoryUsedMb: number;
      memoryTotalMb: number;
      storageUsedMb: number;
      storageTotalMb: number;
    }
  | {
      capturedAt: null;
      cpuPercent: null;
      memoryUsedMb: null;
      memoryTotalMb: null;
      storageUsedMb: null;
      storageTotalMb: null;
    }
);

/**
 * Folds one row per (node, sample) into the dashboard shape: every node appears
 * once, its history ordered oldest first, and the newest sample doubles as
 * `current`. A node with no rows in the window keeps `current: null`, so a dead
 * Agent shows up as a gap rather than silently disappearing.
 */
export function groupByNode(rows: GroupedMetricRow[]): HostMetricNodeReport[] {
  const nodes = new Map<string, HostMetricNodeReport>();

  for (const row of rows) {
    let node = nodes.get(row.nodeId);
    if (!node) {
      node = {
        id: row.nodeId,
        name: row.nodeName,
        status: row.nodeStatus,
        lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
        current: null,
        history: [],
      };
      nodes.set(row.nodeId, node);
    }

    if (!row.capturedAt) {
      continue;
    }

    const sample: HostMetricNodeSample = {
      capturedAt: row.capturedAt.toISOString(),
      cpuPercent: Number(row.cpuPercent),
      memoryUsedMb: row.memoryUsedMb,
      memoryTotalMb: row.memoryTotalMb,
      storageUsedMb: row.storageUsedMb,
      storageTotalMb: row.storageTotalMb,
    };
    node.history.push(sample);
    node.current = sample;
  }

  for (const node of nodes.values()) {
    // Sort defensively: the dashboard contract is oldest first regardless of
    // the order the query happened to return.
    node.history.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    if (node.history.length > 0) {
      node.current = node.history[node.history.length - 1];
    }
  }

  return [...nodes.values()];
}

async function fetchNodeHostSample(node: NodeEndpointRow): Promise<NodeHostSample | null> {
  try {
    // Host metrics are read from the node row, not from `AGENT_BASE_URL`, so the
    // pass keeps working when a second node reports in.
    const sample = await nodeAgent.readHostMetrics({ baseUrl: node.baseUrl, name: node.name });

    return {
      capturedAt: sample.current.capturedAt,
      cpuPercent: sample.current.cpuPercent,
      memoryUsedMb: sample.current.memoryUsedMb,
      memoryTotalMb: sample.current.memoryTotalMb,
      storageUsedMb: sample.current.storageUsedMb,
      storageTotalMb: sample.current.storageTotalMb,
    };
  } catch (error) {
    // One node being down must not stop the pass for the others.
    console.error(`[worker] could not read host metrics from ${node.name}`, error);
    return null;
  }
}
