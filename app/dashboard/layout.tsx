"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { OrganizationOnboarding } from "@/components/organization-onboarding";
import { authClient, useListOrganizations, useSession } from "@/lib/auth-client";
import { defaultOrganization } from "@/components/identity";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { data: organizations, isPending: organizationsPending } = useListOrganizations();
  const activeOrganizationId = session?.session.activeOrganizationId;
  const needsOrganization = !organizationsPending && (organizations?.length ?? 0) === 0;
  const needsActiveOrganization =
    !organizationsPending && !needsOrganization && !!session && !activeOrganizationId;

  useEffect(() => {
    if (!isPending && !session) router.replace("/");
  }, [isPending, router, session]);

  useEffect(() => {
    // Leaving or deleting an Organization clears the active id. Fall back to a
    // remaining membership instead of rendering the dashboard without context.
    if (!needsActiveOrganization) return;
    const fallback = organizations?.[0];
    if (!fallback) return;
    void authClient.organization.setActive({ organizationId: fallback.id }).then((result) => {
      if (!result.error) router.refresh();
    });
  }, [needsActiveOrganization, organizations, router]);

  if (isPending || organizationsPending) {
    return (
      <div className="dashboard-loading" role="status">
        Loading your workspace...
      </div>
    );
  }
  if (!session) return null;

  return (
    <div className="console-layout flex min-h-dvh overflow-x-hidden bg-[#121014] text-[#edecf1] max-[1023px]:block">
      <Sidebar
        organization={defaultOrganization}
        user={{ name: session.user.name || session.user.email, role: "Member" }}
      />
      <main id="dashboard-content" className="console-main user-console-main min-w-0 flex-1">
        {needsOrganization ? <OrganizationOnboarding /> : children}
      </main>
    </div>
  );
}
