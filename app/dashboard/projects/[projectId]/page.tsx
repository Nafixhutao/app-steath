import { ProjectDetail } from "./project-detail";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  return <ProjectDetail projectId={projectId} />;
}
