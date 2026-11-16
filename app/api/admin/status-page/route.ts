import { pool } from "@/lib/platform/db";
import { apiData, withAdmin } from "@/lib/platform/api";

/**
 * Admin status page — mirrors stealth-forge's `/v1/admin/status-page`. The
 * components are the same health probes the Overview answers (api, postgres,
 * redis, agent) mapped onto the public status vocabulary; `published_incidents`
 * lists the active incident titles. Forge stores a configurable page; paas
 * derives the current state at request time, which is what the ported Status
 * Page renders.
 */

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const healthResult = await pool.query<{
      node_status: string | null;
      node_last_seen: Date | null;
    }>(`
  SELECT n."status" AS "node_status", n."lastSeenAt" AS "node_last_seen"
  FROM "node" n
  ORDER BY n."createdAt"
  LIMIT 1
`);

    const node = healthResult.rows[0];
    const nodeStale =
      !node?.node_last_seen || Date.now() - new Date(node.node_last_seen).getTime() > 120_000;

    const incidentResult = await pool.query<{
      title: string;
      started_at: Date;
    }>(`
  SELECT "title", "startedAt" AS "started_at"
  FROM "admin_incident"
  WHERE "status" <> 'resolved'
  ORDER BY "startedAt" DESC
  LIMIT 20
`);

    const agentHealthy = node?.node_status === "healthy" && !nodeStale;

    const components = [
      { name: "API", status: "operational" },
      { name: "Database", status: "operational" },
      // Redis is not part of the production stack yet; the status page keeps
      // the honest unavailable state instead of claiming operational.
      { name: "Cache", status: "unavailable" },
      {
        name: "Agents",
        status: agentHealthy ? "operational" : "unavailable",
      },
    ];

    return apiData({
      name: "Stealth PaaS",
      description: "Live service health for the Stealth platform control plane.",
      is_public: false,
      updated_at: new Date().toISOString(),
      components,
      // Forge publishes resolved-and-active incident titles on the page; paas
      // lists the currently active ones, which is the honest instance state.
      published_incidents: incidentResult.rows.map((row) => row.title),
    });
  });
}
