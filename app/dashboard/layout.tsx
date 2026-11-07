"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { useSession } from "@/lib/auth-client";
import { defaultOrganization } from "@/components/identity";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (!isPending && !session) router.replace("/");
  }, [isPending, router, session]);

  if (isPending) {
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
        {children}
      </main>
    </div>
  );
}
