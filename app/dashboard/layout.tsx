"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { SupabaseTopbar } from "@/components/supabase-topbar";
import { CommandPalette } from "@/components/command-palette";
import { ToastProvider } from "@/components/toast-context";
import { OrganizationOnboarding } from "@/components/organization-onboarding";
import { getAdminStatus } from "@/lib/admin-client";
import { authClient, useListOrganizations, useSession } from "@/lib/auth-client";
import { defaultOrganization, defaultUser } from "@/components/identity";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isOrgsPage = pathname === "/dashboard/organizations";

  const { data: session, isPending } = useSession();
  const { data: organizations, isPending: organizationsPending } = useListOrganizations();
  const activeOrganizationId = session?.session.activeOrganizationId;
  const needsOrganization = !organizationsPending && (organizations?.length ?? 0) === 0;
  const needsActiveOrganization =
    !organizationsPending && !needsOrganization && !!session && !activeOrganizationId && !isOrgsPage;
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isPending && !session) router.replace("/");
  }, [isPending, router, session]);

  useEffect(() => {
    // The sidebar fetches the same status; the layout needs it too, so a
    // Platform Admin with no Organization membership still gets a usable
    // landing page instead of the Organization onboarding gate.
    let cancelled = false;
    getAdminStatus()
      .then((status) => {
        if (!cancelled) setIsPlatformAdmin(status.platformAdmin);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    // A Platform Admin is admin-only: the admin console is their whole
    // surface, so the user dashboard never renders for them even if a
    // leftover Organization membership exists.
    if (!isPlatformAdmin) return;
    router.replace("/admin");
  }, [isPlatformAdmin, router]);

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
    <ToastProvider>
      <div className="console-layout flex flex-col h-dvh max-h-dvh overflow-hidden bg-[#121014] text-[#edecf1]">
        <SupabaseTopbar onOpenSearch={() => setSearchOpen(true)} />

        {isOrgsPage ? (
          <main className="flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden">
            {children}
          </main>
        ) : (
          <div className="flex flex-1 min-h-0 min-w-0 max-[1023px]:block overflow-hidden">
            <Suspense fallback={<div className="sidebar" aria-hidden="true" />}>
              <Sidebar
                organization={defaultOrganization}
                user={{
                  name: session?.user.name || session?.user.email || defaultUser.name,
                  role: "Member",
                }}
              />
            </Suspense>
            <main id="dashboard-content" className="console-main user-console-main min-w-0 flex-1 h-full overflow-y-auto overflow-x-hidden">
              {needsOrganization && !isPlatformAdmin ? <OrganizationOnboarding /> : children}
            </main>
          </div>
        )}

        <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />

        {!ready || signedOut ? (
          <div className="dashboard-gate">
            <div className="dashboard-loading" role="status">
              Loading your Organization...
            </div>
          </div>
        ) : null}
      </div>
    </ToastProvider>
  );
}
