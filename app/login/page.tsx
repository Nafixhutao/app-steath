import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthPageFallback } from "@/components/auth-page-fallback";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign in · Stealth Hosting",
  description: "Sign in to Stealth Hosting to deploy and manage your services.",
};

/**
 * An existing session means there is nothing to sign in to: send the visitor
 * straight to the console instead of showing the form again. `headers()` is
 * request data, so it stays inside the page's Suspense boundary.
 */
async function LoginGate() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    redirect("/dashboard");
  }

  return <AuthForm initialMode="signin" />;
}

/** The dedicated sign-in page, so login has its own address and tab title. */
export default function LoginPage() {
  return (
    <Suspense fallback={<AuthPageFallback />}>
      <LoginGate />
    </Suspense>
  );
}
