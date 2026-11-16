import { pool } from "@/lib/platform/db";
import { apiData, apiError } from "@/lib/platform/api";
import { requirePlatformAdmin } from "@/lib/platform/platform-admin";

/**
 * Admin host metrics — mirrors stealth-forge's `/v1/admin/host-metrics`: one
 * snapshot of the host (CPU, memory, disk, network) plus the retained history
 * inside the requested window. Forge samples /proc in-process every 5s; paas
 * reads the node_agent samples the worker stores in `node_host_metric` (MiB,
 * no network counters — the network series answers flat zeros honestly). The
 * first registered node is the host, which is what the ported panels render.
 */

const MAX_WINDOW_MINUTES = 24 * 60;
const CURRENT_WINDOW_MINUTES = 5;

type SampleRow = {
  timestamp: Date;
  cpu_percent: number;
  memory_used: string;
  memory_total: string;
  disk_used: string;
  disk_total: string;
};

function mibToBytes(value: string | number): number {
  return Math.round(Number(value) * 1024 * 1024);
}

export async function GET(request: Request) {
  try {
    await requirePlatformAdmin(request.headers);

    const url = new URL(request.url);
    const rawWindow = url.searchParams.get("window_minutes");
    let windowMinutes = CURRENT_WINDOW_MINUTES;
    if (rawWindow !== null && rawWindow !== "") {
      windowMinutes = Number.parseInt(rawWindow, 10);
      if (!Number.isFinite(windowMinutes) || windowMinutes < 1) {
        windowMinutes = CURRENT_WINDOW_MINUTES;
      }
    }
    windowMinutes = Math.min(windowMinutes, MAX_WINDOW_MINUTES);

    const result = await pool.query<SampleRow>(
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
      [String(windowMinutes)],
    );

    const history = result.rows.map((row) => ({
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

    return apiData({
      current: history[history.length - 1] ?? null,
      history,
    });
  } catch (error) {
    return apiError(error);
  }
}
