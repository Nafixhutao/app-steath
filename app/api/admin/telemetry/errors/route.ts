import { apiData, withAdmin } from "@/lib/platform/api";
import { listErrorGroups } from "@/lib/platform/admin-work-queries";

/**
 * Admin error groups — mirrors stealth-forge's `/v1/admin/telemetry/errors`.
 * paas aggregates the one error store it has: failed deployments and failed
 * jobs are folded into error groups keyed by a normalized fingerprint, with
 * the Forge lifecycle statuses. A telemetry backend can replace the source of
 * this projection without changing the wire shape.
 */

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const url = new URL(request.url);
    // The Forge client sends an explicit from/to window; fall back to the
    // range label when only that is present.
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const rawRange = url.searchParams.get("range") ?? "24h";
    const rangeHours: Record<string, number> = {
      "1h": 1,
      "6h": 6,
      "24h": 24,
      "7d": 24 * 7,
    };
    const windowHours = rangeHours[rawRange] ?? 24;

    return apiData(await listErrorGroups({ from, to, windowHours }));
  });
}
