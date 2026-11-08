import { ServiceDetail } from "./service-detail";

export default async function ServicePage({ params }: { params: Promise<{ serviceId: string }> }) {
  const { serviceId } = await params;

  return <ServiceDetail serviceId={serviceId} />;
}
