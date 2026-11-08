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
      <p className="dashboard-table-empty" role="status">
        Loading Project...
      </p>
    </div>
  );
}
