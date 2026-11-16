import { Suspense } from "react";
import { AbuseReportsGate } from "./gate";

/**
 * The Platform Admin abuse reports console. The gate resolves the session on
 * the server so a non-admin never downloads the page, and the panel loads and
 * polls its data in the client like the rest of the dashboard.
 */
export default function AbuseReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="admin-page-body">
          <p className="admin-empty" role="status">
            Checking platform access...
          </p>
        </div>
      }
    >
      <AbuseReportsGate />
    </Suspense>
  );
}
