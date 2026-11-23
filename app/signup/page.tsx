import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthPageFallback } from "@/components/auth-page-fallback";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign up · Stealth Hosting",
  description: "Create a Stealth Hosting account to deploy your first service.",
};

/** A signed-in visitor has no reason to create a second account. */
async function SignupGate() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    redirect("/dashboard");
  }

  return <AuthForm initialMode="signup" />;
}

/** The dedicated sign-up page, reachable directly and linked from /login. */
export default function SignupPage() {
  return (
    <Suspense fallback={<AuthPageFallback />}>
      <SignupGate />
    </Suspense>
  );
}
