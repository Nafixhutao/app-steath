import { Suspense } from "react";
import { ProjectGate, ProjectGateFallback } from "./project-gate";

/**
 * `params` is request data, so it is read inside the page's Suspense boundary.
 * Reading it in the page body would block prerendering and make the whole
 * dashboard navigation wait on the Project id.
 */
export default function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  return (
    <Suspense fallback={<ProjectGateFallback />}>
      <ProjectGate params={params} />
    </Suspense>
  );
}
