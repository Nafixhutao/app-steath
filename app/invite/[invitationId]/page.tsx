import { Suspense } from "react";
import { InvitationFallback, InvitationGate } from "./invitation-gate";

export default function InvitationPage({ params }: { params: Promise<{ invitationId: string }> }) {
  return (
    <Suspense fallback={<InvitationFallback />}>
      <InvitationGate params={params} />
    </Suspense>
  );
}
