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
          <div className="dashboard-heading-skeleton w-[min(280px,60%)] h-[28px] rounded-[7px] bg-[#232127]" />
          <div className="dashboard-heading-skeleton w-[min(280px,60%)] h-[28px] rounded-[7px] bg-[#232127] short" />
          <div className="py-[8px]">
            <div className="dashboard-skeleton-row h-[46px] mb-[8px] rounded-card [background:linear-gradient(90deg,#1b1a1f_0%,#26242a_50%,#1b1a1f_100%)] animate-[dashboard-shimmer_1.4s_ease_infinite] last:mb-[0]" />
            <div className="dashboard-skeleton-row h-[46px] mb-[8px] rounded-card [background:linear-gradient(90deg,#1b1a1f_0%,#26242a_50%,#1b1a1f_100%)] animate-[dashboard-shimmer_1.4s_ease_infinite] last:mb-[0]" />
            <div className="dashboard-skeleton-row h-[46px] mb-[8px] rounded-card [background:linear-gradient(90deg,#1b1a1f_0%,#26242a_50%,#1b1a1f_100%)] animate-[dashboard-shimmer_1.4s_ease_infinite] last:mb-[0]" />
          </div>
          <span className="sr-only">Loading Project…</span>
        </div>
      </div>
  );
}
