import { Suspense } from "react";
import { AdminFindingsGate, AdminFindingsFallback } from "./admin-findings-gate";

/**
 * The Platform Admin findings queue. The gate resolves the session on the server
 * so a non-admin never downloads the page, and the panel loads its data in the
 * client like the rest of the dashboard.
 */
export default function AdminFindingsPage() {
  return (
    <Suspense fallback={<AdminFindingsFallback />}>
      <AdminFindingsGate />
    </Suspense>
  );
}
