"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

export function InvitationPanel({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState("Checking invitation...");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void authClient.organization.getInvitation({ query: { id: invitationId } }).then((result) => {
      if (cancelled) return;
      if (result.error || !result.data) {
        setError(result.error?.message ?? "This invitation is invalid or expired.");
        setStatus("");
        return;
      }
      setStatus(`You are invited to join ${result.data.organizationName} as ${result.data.role}.`);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [invitationId]);

  async function accept() {
    setBusy(true);
    setError("");
    const result = await authClient.organization.acceptInvitation({ invitationId });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Could not accept this invitation.");
      return;
    }
    router.replace("/dashboard");
  }

  async function decline() {
    setBusy(true);
    setError("");
    const result = await authClient.organization.rejectInvitation({ invitationId });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Could not decline this invitation.");
      return;
    }
    setStatus("Invitation declined.");
    setReady(false);
  }

  return (
    <main className="invitation-page">
      <section className="invitation-panel">
        <p className="auth-eyebrow">Organization invitation</p>
        <h1>Join an Organization</h1>
        {status ? <p>{status}</p> : null}
        {error ? (
          <p className="dashboard-alert is-error" role="alert">
            {error}
          </p>
        ) : null}
        {ready ? (
          <div className="invitation-actions">
            <button
              className="create-project-button"
              type="button"
              disabled={busy}
              onClick={() => void accept()}
            >
              {busy ? "Please wait..." : "Accept invitation"}
            </button>
            <button
              className="dashboard-secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void decline()}
            >
              Decline
            </button>
          </div>
        ) : null}
        <p>
          <Link href="/dashboard">Back to dashboard</Link>
        </p>
      </section>
    </main>
  );
}
