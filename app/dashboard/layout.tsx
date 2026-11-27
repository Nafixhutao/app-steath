"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { SupabaseTopbar } from "@/components/supabase-topbar";
import { CommandPalette } from "@/components/command-palette";
import { ToastProvider } from "@/components/toast-context";
import { OrganizationOnboarding } from "@/components/organization-onboarding";
import { authClient, useListOrganizations, useSession } from "@/lib/auth-client";
import { defaultOrganization, defaultUser } from "@/components/identity";

/**
 * `usePathname` cannot be resolved while prerendering a route with an unknown
 * dynamic param (for example `/dashboard/projects/[projectId]`). Cache
 * Components therefore requires the component that reads it to sit inside a
 * Suspense boundary, so the shell streams in instead of failing the build.
 * The static fallback keeps the console background so there is no white flash.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<DashboardLayoutFallback />}>
      <DashboardShell>{children}</DashboardShell>
    </Suspense>
  );
}

function DashboardLayoutFallback() {
  return (
    <div className="console-layout max-h-[100dvh] overflow-hidden text-ink-console flex flex-col h-dvh max-h-dvh overflow-hidden bg-[#121014] text-[#edecf1]">
      <div className="dashboard-gate fixed inset-0 z-[60] bg-console">
        <div className="dashboard-loading grid min-h-[100dvh] bg-console text-[#b5b2b9] text-[14px]" role="status">
          Loading your Organization...
        </div>
      </div>
    </div>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isOrgsPage = pathname === "/dashboard/organizations";

  const { data: session, isPending } = useSession();
  const { data: organizations, isPending: organizationsPending } = useListOrganizations();
  const activeOrganizationId = session?.session.activeOrganizationId;
  const needsOrganization = !organizationsPending && (organizations?.length ?? 0) === 0;
  const needsActiveOrganization =
    !organizationsPending &&
    !needsOrganization &&
    !!session &&
    !activeOrganizationId &&
    !isOrgsPage;
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
      <div className="console-layout max-h-[100dvh] overflow-hidden text-ink-console flex flex-col h-dvh max-h-dvh overflow-hidden bg-[#121014] text-[#edecf1]">
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
                  email: session?.user.email,
                  image: session?.user.image,
                  role: "Member",
                }}
              />
            </Suspense>
            <main
              id="dashboard-content"
              className="console-main flex-1 min-w-0 h-full user-console-main min-w-0 flex-1 h-full overflow-y-auto overflow-x-hidden"
            >
              {needsOrganization ? <OrganizationOnboarding /> : children}
            </main>
          </div>
        )}

        <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />

        {!ready || signedOut ? (
          <div className="dashboard-gate fixed inset-0 z-[60] bg-console">
            <div className="dashboard-loading grid min-h-[100dvh] bg-console text-[#b5b2b9] text-[14px]" role="status">
              Loading your Organization...
            </div>
          </div>
        ) : null}
      </div>
    </ToastProvider>
  );
}
