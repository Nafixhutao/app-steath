import { Suspense } from "react";
import { AbuseReportsGate } from "./gate";

export default function AbuseReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="dashboard-content">
          <p role="status">Checking platform access...</p>
        </div>
      }
    >
      <AbuseReportsGate />
    </Suspense>
  );
}
