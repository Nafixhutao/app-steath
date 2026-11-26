import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getAdminSetupSummary } from "@/lib/platform/admin-onboarding";
import { getPlatformAdminStatus } from "@/lib/platform/platform-admin";
import { AdminOverview } from "@/features/admin/overview/admin-overview";
import { AdminWelcome } from "./admin-welcome";

/**
 * The Platform Admin overview. The welcome block is composed here rather than
 * inside the ported Forge component, so `features/admin/**` stays byte-identical
 * (ADR-0008).
 *
 * The gate is repeated here on purpose: the layout's Suspense boundary streams,
 * so this page would otherwise run its server query and resolve its name for a
 * signed-out visitor before the layout redirect lands. Every other admin page
 * reads through authenticated client APIs, but this one reads the database
 * directly, so it must refuse to fetch before it renders.
 */
function displayName(name: string | null | undefined, email: string | null | undefined) {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  const localPart = email?.split("@")[0]?.trim();
  return localPart || "Admin";
}

export default async function AdminHomePage() {
  const requestHeaders = await headers();

  if (!(await getPlatformAdminStatus(requestHeaders))) {
    redirect("/");
  }

  const session = await getSession(requestHeaders);
  const summary = await getAdminSetupSummary();

  return (
    <>
      <AdminWelcome name={displayName(session?.user.name, session?.user.email)} summary={summary} />
      <AdminOverview />
    </>
  );
}
