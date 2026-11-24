import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { safeReturnTo } from "@/lib/return-to";

type HomeSearchParams = { returnTo?: string | string[] };

/**
 * Root is a session-aware entry point: a returning visitor with a live session
 * belongs in the console, everyone else on the sign-in page. Both request
 * inputs stay inside Suspense so the route can still be prerendered.
 */
async function RootGate({ searchParams }: { searchParams: Promise<HomeSearchParams> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) redirect(returnTo ?? "/dashboard");
  redirect(returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login");
  return null;
}

export default function Home({ searchParams }: { searchParams: Promise<HomeSearchParams> }) {
  return (
    <Suspense fallback={null}>
      <RootGate searchParams={searchParams} />
    </Suspense>
  );
}
