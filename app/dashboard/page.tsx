"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useActiveOrganization } from "@/lib/auth-client";

export default function DashboardPage() {
  const router = useRouter();
  const { data: organization, isPending } = useActiveOrganization();

  useEffect(() => {
    if (isPending) return;
    if (organization?.id) {
      router.replace("/dashboard/projects");
    } else {
      router.replace("/dashboard/organizations");
    }
  }, [isPending, organization, router]);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <p className="text-zinc-500 text-sm">Redirecting to projects...</p>
    </div>
  );
}
