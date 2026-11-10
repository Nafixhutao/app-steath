import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPlatformAdminStatus } from "@/lib/platform/platform-admin";
import { FindingsPanel } from "./findings-panel";

/**
 * Server-side guard: a user whose email is not in `PLATFORM_ADMIN_EMAILS` is
 * redirected before the findings panel is ever rendered, so the browser never
 * receives another Organization's findings.
 */
export async function AdminFindingsGate() {
  const platformAdmin = await getPlatformAdminStatus(await headers());

  if (!platformAdmin) {
    redirect("/dashboard");
  }

  return <FindingsPanel />;
}

export function AdminFindingsFallback() {
  return (
    <div className="dashboard-content">
      <p className="dashboard-table-empty" role="status">
        Checking platform access...
      </p>
    </div>
  );
}
