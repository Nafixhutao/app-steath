import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPlatformAdminStatus } from "@/lib/platform/platform-admin";
import { AbuseReportsPanel } from "./abuse-reports-panel";

export async function AbuseReportsGate() {
  if (!(await getPlatformAdminStatus(await headers()))) redirect("/");
  return <AbuseReportsPanel />;
}
