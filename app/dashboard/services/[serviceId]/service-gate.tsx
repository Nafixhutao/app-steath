import { ServiceDetail } from "./service-detail";

/**
 * Resolves the Service id and renders the detail panel. This runs inside the
 * page's Suspense boundary because `params` cannot be prerendered.
 */
export async function ServiceGate({ params }: { params: Promise<{ serviceId: string }> }) {
  const { serviceId } = await params;

  return <ServiceDetail serviceId={serviceId} />;
}

export function ServiceGateFallback() {
  return (
    <div className="dashboard-content">
      <p className="dashboard-table-empty py-[14px] px-0 text-[#9e99a4] text-[13px]" role="status">
        Loading Service...
      </p>
    </div>
  );
}
