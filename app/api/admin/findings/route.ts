import { apiData, withAdmin } from "@/lib/platform/api";
import { listFindings } from "@/lib/platform/scans";

/**
 * Lists ScanFindings across every Organization for a Platform Admin. The
 * findings carry Deployment and Service context only; Environment Variable
 * values and Database passwords are never part of the query.
 */
export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const url = new URL(request.url);
    const urgentOnly = url.searchParams.get("urgent") === "true";

    return apiData(await listFindings({ urgentOnly }));
  });
}
