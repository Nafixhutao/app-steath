import type { BetterAuthOptions } from "better-auth";
import type { GithubOptions, GoogleOptions } from "better-auth/social-providers";
import { APIError } from "better-auth/api";
import { createAccessControl } from "better-auth/plugins/access";
import { organization, username } from "better-auth/plugins";
import { Pool } from "pg";
import { recordAudit, recordPlatformAudit } from "@/lib/platform/audit";
import { socialProviderConfig } from "@/lib/platform/oauth-providers";

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

/**
 * The "provider absent" marker. better-auth's context builder awaits each
 * factory, then drops any config whose `enabled === false` before requiring a
 * clientId — so this shape never reaches the OAuth flow. The declaration type
 * still demands clientId, hence the assertion: the honest alternative (null)
 * is not part of the published type even though the runtime handles it.
 */
const DISABLED_PROVIDER = { enabled: false } as unknown as GithubOptions;

const DISABLED_GITHUB = DISABLED_PROVIDER;
const DISABLED_GOOGLE = DISABLED_PROVIDER as unknown as GoogleOptions;

export const authConfig = {
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Set to false for development (no email service yet)
    // The password-reset flow: better-auth generates the token and the link;
    // delivery records the link in the control-plane log and the audit trail
    // until an email provider is wired in, so the administrator can hand the
    // link to the requester. Swapping in an email service means replacing the
    // body of this callback only.
    sendResetPassword: async ({ user, url }) => {
      console.log(`[password-reset] link for ${user.email} (valid 1 hour): ${url}`);
      try {
        await recordPlatformAudit("platform.password_reset_requested", user.id, {
          delivery: "server-log",
        });
      } catch {
        // The reset link is already in the log; an audit failure must not
        // fail the request.
      }
    },
  },

  // External sign-in providers read their stored credentials at boot: the
  // factory form is awaited once while the auth context is built, and a null
  // drop marks the provider absent. Admin-saved credentials therefore apply
  // on the next control-plane restart, and secret storage stays out of the
  // process environment.
  socialProviders: {
    github: async (): Promise<GithubOptions & { enabled?: boolean }> => {
      try {
        const stored = await socialProviderConfig("github");
        // enabled:false is how better-auth drops a provider: the sign-in
        // endpoint answers "Provider not found" and the login page keeps its
        // honest "Coming soon" state.
        return (stored ?? { enabled: false }) as GithubOptions & { enabled?: boolean };
      } catch (error) {
        console.warn("[oauth-providers] github store read failed:", error);
        return DISABLED_GITHUB;
      }
    },
    google: async (): Promise<GoogleOptions & { enabled?: boolean }> => {
      try {
        const stored = await socialProviderConfig("google");
        return (stored ?? { enabled: false }) as GoogleOptions & { enabled?: boolean };
      } catch (error) {
        console.warn("[oauth-providers] google store read failed:", error);
        return DISABLED_GOOGLE;
      }
    },
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
    // A hosting console is a long-lived tool, so a signed-in session lasts 30
    // days and is refreshed once a day instead of expiring after a week.
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
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
