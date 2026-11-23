import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Root is a session-aware entry point: a returning visitor with a live session
 * belongs in the console, everyone else on the sign-in page. `headers()` is
 * request data, so it is read inside Suspense.
 */
async function RootGate() {
  const session = await auth.api.getSession({ headers: await headers() });

  redirect(session ? "/dashboard" : "/login");
  return null;
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <RootGate />
    </Suspense>
  );
}
