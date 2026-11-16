import { apiData, apiError } from "@/lib/platform/api";
import { requirePlatformAdmin } from "@/lib/platform/platform-admin";

/**
 * Admin API metrics — mirrors stealth-forge's `/v1/admin/api-metrics`. Forge
 * reads the Go runtime; the paas control plane is a Node process, so the same
 * vitals come from `process.memoryUsage()`, the active handle count, and the
 * module-level start time. Numbers are gathered at request time — no sampling,
 * no backend.
 */

const startedAt = Date.now();

export async function GET(request: Request) {
  try {
    await requirePlatformAdmin(request.headers);

    const memory = process.memoryUsage();

    return apiData({
      // Node has no goroutines; the event loop's active file descriptors stand
      // in as the closest concurrent-work counter. The handle accessor is
      // undocumented, so it is read off the process object directly.
      goroutines:
        (process as unknown as { _getActiveHandles?: () => unknown[] })
          ._getActiveHandles?.().length ?? 0,
      heap_alloc_bytes: memory.heapUsed,
      heap_objects: 0,
      stack_bytes: memory.rss - memory.heapTotal,
      sys_bytes: memory.rss,
      gc_runs: 0,
      last_gc_pause_ms: 0,
      go_version: `Node ${process.version}`,
      process_uptime_seconds: (Date.now() - startedAt) / 1000,
    });
  } catch (error) {
    return apiError(error);
  }
}
