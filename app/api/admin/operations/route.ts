import { apiData, withAdmin } from "@/lib/platform/api";
import { listOperations } from "@/lib/platform/admin-work-queries";

/**
 * Admin operations — mirrors stealth-forge's `/v1/admin/operations`: a bounded
 * list of durable control-plane work (deployments + jobs, newest first) in the
 * exact `AdminOperationsResponse` shape ({ items }). `range` selects the
 * window; `limit` caps the list. The execution-queue summary counts come from
 * the overview endpoint, exactly like the source read model wires it.
 */

const RANGES: Record<string, number> = {
  "1h": 60,
  "6h": 6 * 60,
  "24h": 24 * 60,
  "7d": 7 * 24 * 60,
};

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const url = new URL(request.url);
    // The Forge client sends an explicit from/to window; the range label is
    // the fallback when only that is present.
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const rawRange = url.searchParams.get("range") ?? "24h";
    const windowMinutes = RANGES[rawRange] ?? RANGES["24h"];
    const rawLimit = url.searchParams.get("limit");
    let limit = 100;
    if (rawLimit !== null && rawLimit !== "") {
      limit = Number.parseInt(rawLimit, 10);
      if (!Number.isFinite(limit) || limit < 1) limit = 100;
    }
    limit = Math.min(limit, 500);

    return apiData(await listOperations({ from, to, windowMinutes, limit }));
  });
}
