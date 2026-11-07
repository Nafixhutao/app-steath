"use client";

import Link from "next/link";
import { useActiveOrganization } from "@/lib/auth-client";

export default function DashboardPage() {
  const { data: organization } = useActiveOrganization();

  return (
    <div className="dashboard-content">
      <div className="dashboard-page-heading">
        <div>
          <h1>Overview</h1>
          <p>Manage hosting resources for {organization?.name ?? "your Organization"}.</p>
        </div>
      </div>

      <section className="dashboard-section" aria-labelledby="resources-heading">
        <div className="dashboard-section-heading">
          <h2 id="resources-heading">Resources</h2>
          <Link href="/dashboard/projects">View Projects</Link>
        </div>
        <div className="dashboard-empty-state">
          <h3>No resources yet</h3>
          <p>Create a Project to deploy a Service or provision a PostgreSQL Database.</p>
        </div>
      </section>
    </div>
  );
}
