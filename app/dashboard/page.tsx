"use client";

import { Sidebar } from "../../components/sidebar";
import { defaultOrganization, defaultUser } from "../../components/identity";

export default function DashboardPage() {
  return (
    <div className="console-layout flex min-h-dvh overflow-x-hidden bg-[#121014] text-[#edecf1] max-[1023px]:block">
      <Sidebar organization={defaultOrganization} user={defaultUser} />
      <main id="dashboard-content" className="console-main user-console-main ml-1 my-2 mr-2 min-w-0 flex-1 overflow-auto rounded-[14px] border border-[#2A272E] bg-[#1A181D] px-10 py-6 shadow-none max-[1023px]:ml-0 max-[1023px]:mt-[67px] max-[1023px]:mr-2 max-[1023px]:mb-2 max-[1023px]:min-h-[calc(100dvh-75px)]">
        <a className="skip-link" href="#dashboard-content">
          Skip to content
        </a>
      </main>
    </div>
  );
}
