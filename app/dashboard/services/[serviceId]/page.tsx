import { Suspense } from "react";
import { ServiceGate, ServiceGateFallback } from "./service-gate";

/**
 * `params` is request data, so it is read inside the page's Suspense boundary.
 * Reading it in the page body would block prerendering and make the whole
 * dashboard navigation wait on the Service id.
 */
export default function ServicePage({ params }: { params: Promise<{ serviceId: string }> }) {
  return (
    <Suspense fallback={<ServiceGateFallback />}>
      <ServiceGate params={params} />
    </Suspense>
  );
}
