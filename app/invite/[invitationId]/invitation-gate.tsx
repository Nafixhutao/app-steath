import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { InvitationPanel } from "./invitation-panel";

/**
 * Resolves the session on the server so a freshly signed-in recipient is never
 * bounced back to the sign-in page while the client store hydrates. This runs
 * inside the page's Suspense boundary because reading request data cannot be
 * prerendered into the static shell.
 */
export async function InvitationGate({ params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect(`/?returnTo=${encodeURIComponent(`/invite/${invitationId}`)}`);
  }

  return <InvitationPanel invitationId={invitationId} />;
}

export function InvitationFallback() {
  return (
    <main className="invitation-page">
      <section className="invitation-panel" role="status">
        Checking invitation...
      </section>
    </main>
  );
}
