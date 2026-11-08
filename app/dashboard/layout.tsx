"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { OrganizationOnboarding } from "@/components/organization-onboarding";
import { authClient, useListOrganizations, useSession } from "@/lib/auth-client";
import { defaultOrganization, defaultUser } from "@/components/identity";

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

  // The session is unknown during prerendering, so `children` is always rendered
  // and the loading and onboarding states are painted over it instead of
  // replacing it. Returning early here would drop every child segment from the
  // render tree, which disables Next.js instant-navigation validation for the
  // whole dashboard and leaves real navigation bugs undetected.
  const ready = !isPending && !organizationsPending;
  const signedOut = ready && !session;

  return (
    <div className="console-layout flex min-h-dvh overflow-x-hidden bg-[#121014] text-[#edecf1] max-[1023px]:block">
      {/*
        The Sidebar reads `usePathname()`, which is only known at runtime. The
        Suspense boundary lets the shell prerender and streams the active link
        afterwards, instead of blocking the whole dashboard from prerendering.
      */}
      <Suspense fallback={<div className="sidebar" aria-hidden="true" />}>
        <Sidebar
          organization={defaultOrganization}
          user={{
            name: session?.user.name || session?.user.email || defaultUser.name,
            role: "Member",
          }}
        />
      </Suspense>
      <main id="dashboard-content" className="console-main user-console-main min-w-0 flex-1">
        {needsOrganization ? <OrganizationOnboarding /> : children}
      </main>

      {!ready || signedOut ? (
        <div className="dashboard-gate">
          <div className="dashboard-loading" role="status">
            Loading your workspace...
          </div>
        </div>
      ) : null}
    </div>
  );
}
