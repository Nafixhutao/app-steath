import { auth } from "@/lib/auth";
import { TenantAccessError } from "./tenant";

/**
 * Platform Admin access. A Platform Admin is defined by an email address in the
 * `PLATFORM_ADMIN_EMAILS` environment variable rather than by a database role,
 * so granting cross-Organization visibility is an explicit deployment decision.
 * The list is comma separated and compared case-insensitively.
 */

export type PlatformAdminContext = {
  userId: string;
  email: string;
};

/** The configured admin emails, normalized for comparison. */
export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email !== "");
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }

  return platformAdminEmails().includes(email.trim().toLowerCase());
}

/**
 * Resolves the signed-in user and requires that they are a Platform Admin.
 * Admins are global, so this deliberately does not consult the active
 * Organization: a Platform Admin may have no Membership at all.
 */
export async function requirePlatformAdmin(headers: Headers): Promise<PlatformAdminContext> {
  const current = await auth.api.getSession({ headers });

  if (!current) {
    throw new TenantAccessError(401, "Authentication required");
  }
  if (!isPlatformAdminEmail(current.user.email)) {
    throw new TenantAccessError(403, "Platform Admin access required");
  }

  return { userId: current.user.id, email: current.user.email };
}

/** Whether the signed-in user is a Platform Admin, for the dashboard navigation. */
export async function getPlatformAdminStatus(headers: Headers): Promise<boolean> {
  const current = await auth.api.getSession({ headers });

  return Boolean(current && isPlatformAdminEmail(current.user.email));
}
