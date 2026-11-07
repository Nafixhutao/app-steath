import { Pool } from "pg";
import { TenantAccessError, requireActiveOrganization } from "@/lib/platform/tenant";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function requireOrganizationRole(headers: Headers, allowed: string[]) {
  const organization = await requireActiveOrganization(headers);
  if (!allowed.includes(organization.role)) {
    throw new TenantAccessError(403, "Insufficient Organization role");
  }
  return organization;
}

export function organizationErrorResponse(error: unknown) {
  if (error instanceof TenantAccessError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("Organization management request failed", error);
  return Response.json({ error: "Organization request failed" }, { status: 500 });
}

export async function listOrganizationMembers(organizationId: string) {
  const result = await pool.query(
    `SELECT m."id", m."userId", m."role", m."createdAt", u."name", u."email"
     FROM "member" m JOIN "user" u ON u."id" = m."userId"
     WHERE m."organizationId" = $1 ORDER BY m."createdAt", u."email"`,
    [organizationId],
  );
  return result.rows;
}

export async function listOrganizationInvitations(organizationId: string) {
  const result = await pool.query(
    `SELECT i."id", i."email", i."role", i."status", i."expiresAt", i."createdAt", u."name" AS "inviterName"
     FROM "invitation" i JOIN "user" u ON u."id" = i."inviterId"
     WHERE i."organizationId" = $1 AND i."status" = 'pending'
     ORDER BY i."createdAt" DESC`,
    [organizationId],
  );
  return result.rows;
}

export async function deleteOrganizationWithConfirmation(input: {
  organizationId: string;
  actorUserId: string;
  name: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const membership = await client.query<{ role: string }>(
      'SELECT "role" FROM "member" WHERE "organizationId" = $1 AND "userId" = $2 FOR UPDATE',
      [input.organizationId, input.actorUserId],
    );
    if (!membership.rows[0]?.role.split(",").includes("owner")) {
      await client.query("ROLLBACK");
      return false;
    }
    const organization = await client.query<{ name: string }>(
      'SELECT "name" FROM "organization" WHERE "id" = $1 FOR UPDATE',
      [input.organizationId],
    );
    if (organization.rows[0]?.name !== input.name) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query("SELECT set_config('platform.allow_owner_removal', 'true', true)");
    await client.query(
      'UPDATE "session" SET "activeOrganizationId" = NULL WHERE "activeOrganizationId" = $1',
      [input.organizationId],
    );
    await client.query('DELETE FROM "invitation" WHERE "organizationId" = $1', [
      input.organizationId,
    ]);
    await client.query('DELETE FROM "member" WHERE "organizationId" = $1', [input.organizationId]);
    await client.query('DELETE FROM "organization" WHERE "id" = $1', [input.organizationId]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
