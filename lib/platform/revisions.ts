import { pool } from "./db.ts";

/**
 * True when the Deployment that is actually serving traffic was started before
 * the Service's current configuration revision. Older Deployments stay `running`
 * in the history because they did serve traffic once, so the live container is
 * the running row with the newest `finishedAt` -- that timestamp is written when
 * a Deployment becomes running. Comparing against the highest revision instead
 * would let a stale history row hide a stale container. Without a running
 * Deployment there is nothing live to be stale, so the flag is false.
 *
 * Written against the alias "s" so a projection can embed it as one column.
 */
export const SERVICE_NEEDS_REDEPLOY = `
  EXISTS (
    SELECT 1 FROM "deployment" rd
    WHERE rd."serviceId" = s."id" AND rd."status" = 'running'
  ) AND s."envRevision" > COALESCE((
    SELECT rd."envRevision" FROM "deployment" rd
    WHERE rd."serviceId" = s."id" AND rd."status" = 'running'
    ORDER BY rd."finishedAt" DESC NULLS LAST, rd."id" DESC
    LIMIT 1
  ), 0)`.trim();

/**
 * Reads the redeploy flag for one Service. Used by callers whose query does not
 * already read from `service`; a projection embeds the constant instead.
 */
export async function serviceNeedsRedeploy(serviceId: string): Promise<boolean> {
  const result = await pool.query<{ needsRedeploy: boolean }>(
    `SELECT ${SERVICE_NEEDS_REDEPLOY} AS "needsRedeploy" FROM "service" s WHERE s."id" = $1`,
    [serviceId],
  );

  return result.rows[0]?.needsRedeploy ?? false;
}

/**
 * True when any Service in the Project needs a redeploy. A Project Database
 * change bumps every Service in the Project, so the Database panel asks the
 * question at Project scope.
 */
export async function projectNeedsRedeploy(projectId: string): Promise<boolean> {
  const result = await pool.query<{ needsRedeploy: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM "service" s
       WHERE s."projectId" = $1 AND (${SERVICE_NEEDS_REDEPLOY})
     ) AS "needsRedeploy"`,
    [projectId],
  );

  return result.rows[0]?.needsRedeploy ?? false;
}

/**
 * Bumps the Service's configuration revision, which is what `needsRedeploy`
 * compares against the live Deployment. Shared by Volumes and Environment
 * Variables so one redeploy applies every pending change; a Project Database
 * change uses `bumpProjectRevisions` instead.
 */
export async function bumpRevision(serviceId: string): Promise<void> {
  await pool.query('UPDATE "service" SET "envRevision" = "envRevision" + 1 WHERE "id" = $1', [
    serviceId,
  ]);
}

/**
 * Bumps every Service in the Project, which is how a Project Database change
 * marks every container that holds the old credentials.
 */
export async function bumpProjectRevisions(projectId: string): Promise<void> {
  await pool.query(
    'UPDATE "service" SET "envRevision" = "envRevision" + 1 WHERE "projectId" = $1',
    [projectId],
  );
}
