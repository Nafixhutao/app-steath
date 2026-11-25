import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthPageFallback } from "@/components/auth-page-fallback";
import { auth } from "@/lib/auth";
import { safeReturnTo } from "@/lib/return-to";

export const metadata: Metadata = {
  title: "Sign up · Stealth Hosting",
  description: "Create a Stealth Hosting account to deploy your first service.",
};

/** A signed-in visitor has no reason to create a second account. */
type SignupSearchParams = { returnTo?: string | string[] };

async function SignupGate({ searchParams }: { searchParams: Promise<SignupSearchParams> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    redirect(returnTo ?? "/dashboard");
  }

  return <AuthForm initialMode="signup" />;
}

/** The dedicated sign-up page, reachable directly and linked from /login. */
export default function SignupPage({
  searchParams,
}: {
  searchParams: Promise<SignupSearchParams>;
}) {
  return (
    <Suspense fallback={<AuthPageFallback />}>
      <SignupGate searchParams={searchParams} />
    </Suspense>
  );
}
