import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { createAccessControl } from "better-auth/plugins/access";
import { organization, username } from "better-auth/plugins";
import { Pool } from "pg";
import { recordAudit } from "@/lib/platform/audit";

const countPool = new Pool({ connectionString: process.env.DATABASE_URL });

const organizationAc = createAccessControl({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  ac: ["read"],
});

const OWNER_ROLE_CHECK = `SELECT count(*) FROM "member"
  WHERE "organizationId" = $1 AND 'owner' = ANY(string_to_array("role", ','))`;

async function ownerCount(organizationId: string): Promise<number> {
  const result = await countPool.query<{ count: string }>(OWNER_ROLE_CHECK, [organizationId]);
  return Number(result.rows[0]?.count ?? 0);
}

const organizationRoles = {
  owner: organizationAc.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    ac: ["read"],
  }),
  admin: organizationAc.newRole({
    organization: [],
    member: ["create", "update"],
    invitation: ["create", "cancel"],
    ac: ["read"],
  }),
  member: organizationAc.newRole({
    organization: [],
    member: [],
    invitation: [],
    ac: ["read"],
  }),
};

export const authConfig = {
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Set to false for development (no email service yet)
  },

  plugins: [
    username(),
    organization({
      ac: organizationAc,
      roles: organizationRoles,
      invitationExpiresIn: 60 * 60 * 24 * 7,
      disableOrganizationDeletion: true,
      organizationHooks: {
        beforeUpdateMemberRole: async ({ member, newRole, organization: org }) => {
          if (member.role.split(",").includes("owner") && !newRole.split(",").includes("owner")) {
            const owners = await ownerCount(org.id);
            if (owners <= 1) {
              throw APIError.fromStatus("BAD_REQUEST", {
                message: "The last Organization owner cannot be demoted",
              });
            }
          }
        },
        beforeRemoveMember: async ({ member, organization: org }) => {
          if (!member.role.split(",").includes("owner")) return;
          const owners = await ownerCount(org.id);
          if (owners <= 1) {
            throw APIError.fromStatus("BAD_REQUEST", {
              message: "The last Organization owner cannot be removed",
            });
          }
        },
        afterCreateInvitation: ({ invitation, inviter, organization: org }) =>
          recordAudit("invitation.created", org.id, inviter.id, undefined, {
            invitationId: invitation.id,
            email: invitation.email,
            role: invitation.role,
          }),
        afterAcceptInvitation: ({ invitation, member, user, organization: org }) =>
          recordAudit("member.joined", org.id, user.id, member.userId, {
            invitationId: invitation.id,
            role: member.role,
          }),
        afterRejectInvitation: ({ invitation, user, organization: org }) =>
          recordAudit("invitation.rejected", org.id, user.id, undefined, {
            invitationId: invitation.id,
          }),
        afterCancelInvitation: ({ invitation, cancelledBy, organization: org }) =>
          recordAudit("invitation.cancelled", org.id, cancelledBy.id, undefined, {
            invitationId: invitation.id,
          }),
        afterUpdateOrganization: ({ organization: org, user, member }) => {
          if (!org) return Promise.resolve();
          return recordAudit("organization.updated", org.id, user.id, member.userId, {
            name: org.name,
            slug: org.slug,
          });
        },
      },
    }),
  ],

  session: {
    cookieCache: {
      enabled: false,
    },
  },

  advanced: {
    database: {
      generateId: "uuid",
    },
  },

  // Log auth events in development
  logger: {
    level: process.env.NODE_ENV === "production" ? "error" : "debug",
  },
} satisfies Omit<BetterAuthOptions, "database">;
