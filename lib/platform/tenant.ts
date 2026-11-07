import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export class TenantAccessError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "TenantAccessError";
  }
}

export type ActiveOrganizationContext = {
  userId: string;
  sessionId: string;
  organizationId: string;
  role: string;
};

export async function requireActiveOrganization(
  headers: Headers,
): Promise<ActiveOrganizationContext> {
  const current = await auth.api.getSession({ headers });

  if (!current) {
    throw new TenantAccessError(401, "Authentication required");
  }

  const organizationId = current.session.activeOrganizationId;
  if (!organizationId) {
    throw new TenantAccessError(403, "No active Organization");
  }

  const membership = await pool.query<{ role: string }>(
    'SELECT "role" FROM "member" WHERE "organizationId" = $1 AND "userId" = $2',
    [organizationId, current.user.id],
  );

  if (!membership.rows[0]) {
    throw new TenantAccessError(403, "Not a Member of the active Organization");
  }

  return {
    userId: current.user.id,
    sessionId: current.session.id,
    organizationId,
    role: membership.rows[0].role,
  };
}
