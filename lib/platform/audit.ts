import { Pool } from "pg";

const auditPool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Persists an AuditEvent for membership, role, Organization, and platform changes.
 * Shared by the Better Auth organization hooks and custom API routes. A system
 * action such as a scheduled Backup has no signed-in actor, so `actorUserId`
 * may be null.
 */
export async function recordAudit(
  action: string,
  organizationId: string,
  actorUserId: string | null,
  targetUserId?: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await auditPool.query(
    `INSERT INTO "audit_event" ("organizationId", "actorUserId", "targetUserId", "action", "details")
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [organizationId, actorUserId, targetUserId ?? null, action, JSON.stringify(details)],
  );
}

/** Platform actions are global and deliberately have no tenant target. */
export async function recordPlatformAudit(
  action: string,
  actorUserId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  if (!action.startsWith("platform."))
    throw new Error("Platform audit actions must use the platform namespace.");
  await auditPool.query(
    `INSERT INTO "audit_event" ("organizationId", "actorUserId", "action", "details")
     VALUES (NULL, $1, $2, $3::jsonb)`,
    [actorUserId, action, JSON.stringify(details)],
  );
}

export { auditPool };
