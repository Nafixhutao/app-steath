import { Pool } from "pg";
import { createAgentClient } from "../../lib/agent-client.ts";
import { nodeConfig } from "./nodes.ts";

/**
 * Image scanning. The Node Agent runs Trivy and ClamAV; the Control Plane stores
 * the findings so a Platform Admin can review them across Organizations. Scanning
 * is advisory: a finding never suspends a Service, and a scan that could not run
 * is recorded as an informational finding rather than lost.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const SCAN_JOB_TYPE = "scan";

export type ScanScanner = "trivy" | "clamav";
export type ScanSeverity = "critical" | "high" | "medium" | "low" | "info" | "unknown";

export type ScanFindingSummary = {
  id: string;
  deploymentId: string;
  scanner: ScanScanner;
  severity: ScanSeverity;
  title: string;
  details: Record<string, unknown>;
  urgent: boolean;
  createdAt: string;
  organizationId: string;
  organizationName: string;
  projectId: string;
  projectName: string;
  serviceId: string;
  serviceName: string;
  commitSha: string | null;
  imageRef: string | null;
};

export type ScanFindingList = {
  findings: ScanFindingSummary[];
  /** How many urgent findings exist, so the dashboard can badge the queue. */
  urgent: number;
  total: number;
};

type ScanFindingRow = {
  id: string;
  deploymentId: string;
  scanner: ScanScanner;
  severity: ScanSeverity;
  title: string;
  details: Record<string, unknown>;
  urgent: boolean;
  createdAt: Date;
  organizationId: string;
  organizationName: string;
  projectId: string;
  projectName: string;
  serviceId: string;
  serviceName: string;
  commitSha: string | null;
  imageRef: string | null;
};

/**
 * Queues one scan for a Deployment. It runs after the Deployment is already
 * serving, so a slow Trivy database download never delays a release. A second
 * request for the same Deployment is a no-op while one is still queued or
 * running.
 */
export async function enqueueScanJob(deploymentId: string): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO "job" ("id", "type", "payload")
     SELECT gen_random_uuid()::text, $1, jsonb_build_object('deploymentId', $2::text)
     WHERE NOT EXISTS (
       SELECT 1 FROM "job"
       WHERE "type" = $1 AND "payload"->>'deploymentId' = $2
         AND "status" IN ('queued', 'running')
     )`,
    [SCAN_JOB_TYPE, deploymentId],
  );

  return (result.rowCount ?? 0) > 0;
}

type AgentFinding = {
  scanner?: string;
  severity?: string;
  title?: string;
  details?: Record<string, unknown>;
};

function isUrgent(scanner: string, severity: string): boolean {
  // Only malware is urgent. A vulnerability is a weakness in a package; a
  // ClamAV match is a concrete malicious file.
  return scanner === "clamav" && (severity === "critical" || severity === "high");
}

async function replaceFindings(
  deploymentId: string,
  findings: Array<{
    scanner: string;
    severity: string;
    title: string;
    details: Record<string, unknown>;
  }>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query('DELETE FROM "scan_finding" WHERE "deploymentId" = $1', [deploymentId]);

    for (const finding of findings) {
      await client.query(
        `INSERT INTO "scan_finding" ("id", "deploymentId", "scanner", "severity",
           "title", "details", "urgent")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5::jsonb, $6)`,
        [
          deploymentId,
          finding.scanner,
          finding.severity,
          finding.title,
          JSON.stringify(finding.details),
          isUrgent(finding.scanner, finding.severity),
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Runs one queued Scan Job. Findings from an earlier attempt are replaced, so a
 * retry never leaves duplicates behind.
 */
export async function runScanJob(job: {
  id: string;
  payload: { deploymentId?: string };
}): Promise<{ status: "completed" | "failed" }> {
  const deploymentId = job.payload.deploymentId;
  if (!deploymentId) {
    throw new Error("Scan Job is missing its deploymentId.");
  }

  const deployment = await pool.query<{
    imageRef: string | null;
    status: string;
  }>('SELECT "imageRef", "status" FROM "deployment" WHERE "id" = $1', [deploymentId]);

  const row = deployment.rows[0];
  // The Deployment may have been deleted with its Service, or it may never have
  // produced an image. Neither is an error.
  if (!row || !row.imageRef) {
    return { status: "completed" };
  }

  const client = createAgentClient(nodeConfig().baseUrl, nodeConfig().token);

  try {
    const response = await client.POST("/v1/scans", {
      body: { deploymentId, imageRef: row.imageRef },
    });

    if (!response.response.ok || !response.data) {
      throw new Error(
        `the Node Agent rejected the Scan (${response.response.status})`,
      );
    }

    const findings = (response.data.findings ?? []).map((finding: AgentFinding) => ({
      scanner: finding.scanner ?? "trivy",
      severity: finding.severity ?? "unknown",
      title: finding.title ?? "Finding",
      details: finding.details ?? {},
    }));

    await replaceFindings(deploymentId, findings);

    return { status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Record the failure so the admin queue shows that this image was not
    // checked, then rethrow so the worker retries a transient Agent problem.
    await replaceFindings(deploymentId, [
      {
        scanner: "trivy",
        severity: "info",
        title: "The image scan could not run",
        details: { kind: "scan_error", error: message },
      },
    ]).catch((recordError) => {
      console.error("could not record the failed Scan", recordError);
    });

    throw error;
  }
}

/**
 * Lists findings across every Organization for a Platform Admin. Findings carry
 * the Deployment and Service context an admin needs to triage a report, and
 * never include Environment Variable values or Database passwords.
 */
export async function listFindings(options: {
  urgentOnly?: boolean;
  limit?: number;
} = {}): Promise<ScanFindingList> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);

  const findings = await pool.query<ScanFindingRow>(
    `SELECT f."id", f."deploymentId", f."scanner", f."severity", f."title",
            f."details", f."urgent", f."createdAt",
            o."id" AS "organizationId", o."name" AS "organizationName",
            p."id" AS "projectId", p."name" AS "projectName",
            s."id" AS "serviceId", s."name" AS "serviceName",
            d."commitSha", d."imageRef"
     FROM "scan_finding" f
     JOIN "deployment" d ON d."id" = f."deploymentId"
     JOIN "service" s ON s."id" = d."serviceId"
     JOIN "project" p ON p."id" = s."projectId"
     JOIN "organization" o ON o."id" = p."organizationId"
     ${options.urgentOnly ? 'WHERE f."urgent"' : ""}
     ORDER BY f."urgent" DESC, f."createdAt" DESC
     LIMIT $1`,
    [limit],
  );

  const counts = await pool.query<{ total: string; urgent: string }>(
    `SELECT count(*)::text AS "total",
            count(*) FILTER (WHERE "urgent")::text AS "urgent"
     FROM "scan_finding"`,
  );

  return {
    findings: findings.rows.map((row) => ({
      id: row.id,
      deploymentId: row.deploymentId,
      scanner: row.scanner,
      severity: row.severity,
      title: row.title,
      details: row.details,
      urgent: row.urgent,
      createdAt: row.createdAt.toISOString(),
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      projectId: row.projectId,
      projectName: row.projectName,
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      commitSha: row.commitSha,
      imageRef: row.imageRef,
    })),
    total: Number(counts.rows[0]?.total ?? 0),
    urgent: Number(counts.rows[0]?.urgent ?? 0),
  };
}
