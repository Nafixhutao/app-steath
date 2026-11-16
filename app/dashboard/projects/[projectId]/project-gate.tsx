import { ProjectDetail } from "./project-detail";

/**
 * Resolves the Project id and renders the detail panel. This runs inside the
 * page's Suspense boundary because `params` cannot be prerendered.
 */
export async function ProjectGate({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  return <ProjectDetail projectId={projectId} />;
}

export function ProjectGateFallback() {
  return (
      <div className="dashboard-content">
        <div role="status" aria-label="Loading project">
          <div className="dashboard-heading-skeleton" />
          <div className="dashboard-heading-skeleton short" />
          <div className="dashboard-skeleton">
            <div className="dashboard-skeleton-row" />
            <div className="dashboard-skeleton-row" />
            <div className="dashboard-skeleton-row" />
          </div>
          <span className="sr-only">Loading Project…</span>
        </div>
      </div>
  );
}
