import { describe, expect, it } from "vitest";
import { groupByNode } from "../../lib/platform/host-metrics.ts";

/** Builds one metric row like the SQL LEFT JOIN would produce. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    nodeId: "node-1",
    nodeName: "node-1",
    nodeStatus: "healthy",
    lastSeenAt: new Date("2026-01-15T09:00:00Z"),
    capturedAt: new Date("2026-01-15T09:05:00Z"),
    cpuPercent: "12.50",
    memoryUsedMb: 2048,
    memoryTotalMb: 8192,
    storageUsedMb: 51200,
    storageTotalMb: 204800,
    ...overrides,
  };
}

describe("groupByNode", () => {
  it("folds rows into one node with history ordered oldest first", () => {
    const nodes = groupByNode([
      row({ capturedAt: new Date("2026-01-15T09:06:00Z"), cpuPercent: "20.00" }),
      row({ capturedAt: new Date("2026-01-15T09:05:00Z"), cpuPercent: "12.50" }),
    ]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].history.map((sample) => sample.cpuPercent)).toEqual([12.5, 20]);
    // The newest sample doubles as current.
    expect(nodes[0].current?.cpuPercent).toBe(20);
  });

  it("keeps a node without rows visible with a null current", () => {
    const nodes = groupByNode([
      row({ nodeId: "node-2", nodeName: "node-2", capturedAt: null, cpuPercent: null }),
    ]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].current).toBeNull();
    expect(nodes[0].history).toHaveLength(0);
    expect(nodes[0].name).toBe("node-2");
  });

  it("separates nodes and carries their status through", () => {
    const nodes = groupByNode([
      row({ nodeId: "a", nodeName: "alpha" }),
      row({ nodeId: "b", nodeName: "beta", nodeStatus: "unhealthy" }),
    ]);

    expect(nodes.map((node) => node.name)).toEqual(["alpha", "beta"]);
    expect(nodes[1].status).toBe("unhealthy");
  });

  it("stores the last heartbeat as an ISO string", () => {
    const nodes = groupByNode([row()]);

    expect(nodes[0].lastSeenAt).toBe("2026-01-15T09:00:00.000Z");
  });
});
