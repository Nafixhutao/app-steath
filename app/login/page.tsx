import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthPageFallback } from "@/components/auth-page-fallback";
import { auth } from "@/lib/auth";
import { safeReturnTo } from "@/lib/return-to";

export const metadata: Metadata = {
  title: "Sign in · Stealth Hosting",
  description: "Sign in to Stealth Hosting to deploy and manage your services.",
};

/**
 * An existing session means there is nothing to sign in to: send the visitor
 * straight to the console instead of showing the form again. `headers()` is
 * request data, so it stays inside the page's Suspense boundary.
 */
type LoginSearchParams = { returnTo?: string | string[] };

async function LoginGate({ searchParams }: { searchParams: Promise<LoginSearchParams> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    redirect(returnTo ?? "/dashboard");
  }

  return <AuthForm initialMode="signin" />;
}

/** The dedicated sign-in page, so login has its own address and tab title. */
export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<LoginSearchParams>;
}) {
  return (
    <Suspense fallback={<AuthPageFallback />}>
      <LoginGate searchParams={searchParams} />
    </Suspense>
  );
}
