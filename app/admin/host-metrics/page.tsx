import { InfrastructurePage } from "@/features/admin/infrastructure/infrastructure-page";

/**
 * The old host-metrics page showed the same node samples the ported
 * Infrastructure page renders with the exact Forge design, so the route now
 * serves that page and the legacy panel is gone.
 */
export default function AdminHostMetricsPage() {
  return <InfrastructurePage />;
}
