import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPlatformAdminStatus } from "@/lib/platform/platform-admin";
import { AdminShell } from "@/features/admin/components/admin-shell";

/**
 * Server-side admin gate: resolves the session and redirects a signed-out
 * visitor or a non-admin before the admin chrome renders. Wrapped in
 * Suspense so the shell streams instead of blocking the prerender. The shell
 * is the ported stealth-forge AdminShell, so every admin page shares its
 * exact chrome.
 */
async function AdminGateContent({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!(await getPlatformAdminStatus(await headers()))) {
    redirect("/");
  }

  return <AdminShell>{children}</AdminShell>;
}

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <Suspense fallback={null}>
      <AdminGateContent>{children}</AdminGateContent>
    </Suspense>
  );
}
