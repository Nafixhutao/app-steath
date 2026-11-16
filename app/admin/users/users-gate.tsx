import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPlatformAdminStatus } from "@/lib/platform/platform-admin";
import type { ReactNode } from "react";

/**
 * Server-side guard: a user whose email is not in `PLATFORM_ADMIN_EMAILS` is
 * redirected before the directory is ever rendered, so the browser never
 * receives account data for an account that should not see it.
 */
export async function UsersGate({ children }: { children: ReactNode }) {
  const platformAdmin = await getPlatformAdminStatus(await headers());

  if (!platformAdmin) {
    redirect("/");
  }

  return <>{children}</>;
}

export function UsersFallback() {
  return (
    <div className="admin-page-body">
      <p className="admin-empty" role="status">
        Checking platform access...
      </p>
    </div>
  );
}
