import { Suspense } from "react";
import { AdminFindingsGate, AdminFindingsFallback } from "./admin-findings-gate";
import { FindingsPanel } from "./findings-panel";

/**
 * The Platform Admin scan findings console. The gate resolves the session on
 * the server so a non-admin never downloads the page, and the panel loads and
 * polls its data in the client like the rest of the dashboard.
 */
export default function FindingsPage() {
  return (
    <Suspense fallback={<AdminFindingsFallback />}>
      <AdminFindingsGate>
        <FindingsPanel />
      </AdminFindingsGate>
    </Suspense>
  );
}
