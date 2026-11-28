import { ProjectDetail } from "./project-detail";

export const skeletonRowClass = [
  "h-[46px] mb-[8px] rounded-card",
  "[background:linear-gradient(90deg,#1b1a1f_0%,#26242a_50%,#1b1a1f_100%)_0_0_/_200%_100%]",
  "animate-[dashboard-shimmer_1.4s_ease_infinite] last:mb-[0]",
].join(" ");

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
          <div className="dashboard-heading-skeleton w-[min(170px,40%)] h-[14px] mt-[10px] rounded-[7px] bg-[#232127]" />
          <div className="py-[8px]">
            <div className={skeletonRowClass} />
            <div className={skeletonRowClass} />
            <div className={skeletonRowClass} />
          </div>
          <span className="sr-only">Loading Project…</span>
        </div>
      </div>
  );
}
