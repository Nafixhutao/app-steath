import { Pool } from "pg";

const auditPool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Persists an AuditEvent for membership, role, and Organization changes.
 * Shared by the Better Auth organization hooks and custom API routes.
 */
export async function recordAudit(
  action: string,
  organizationId: string,
  actorUserId: string,
  targetUserId?: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await auditPool.query(
    `INSERT INTO "audit_event" ("organizationId", "actorUserId", "targetUserId", "action", "details")
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [organizationId, actorUserId, targetUserId ?? null, action, JSON.stringify(details)],
  );
}

export { auditPool };
