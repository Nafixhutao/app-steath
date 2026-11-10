import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPlatformAdminStatus } from "@/lib/platform/platform-admin";
import { AbuseAdminPanel } from "./panel";

export async function AbuseReportsGate() {
  if (!(await getPlatformAdminStatus(await headers()))) redirect("/dashboard");
  return <AbuseAdminPanel />;
}
