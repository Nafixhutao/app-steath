import { Suspense } from "react";
import { OverviewGate, OverviewFallback } from "./overview-gate";
import { OverviewPanel } from "./overview-panel";

/**
 * The Platform Admin overview. The gate resolves the session on the server so
 * a non-admin never downloads the page, and the panel loads and polls its data
 * in the client like the rest of the dashboard.
 */
export default function AdminOverviewPage() {
  return (
    <Suspense fallback={<OverviewFallback />}>
      <OverviewGate>
        <OverviewPanel />
      </OverviewGate>
    </Suspense>
  );
}
