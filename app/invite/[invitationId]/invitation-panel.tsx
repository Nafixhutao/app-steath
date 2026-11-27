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
    <main className="invitation-page grid min-h-[100dvh] p-[24px] bg-console text-ink-console">
      <section className="invitation-panel">
        <p className="auth-eyebrow">Organization invitation</p>
        <h1>Join an Organization</h1>
        {status ? <p>{status}</p> : null}
        {error ? (
          <p className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error" role="alert">
            {error}
          </p>
        ) : null}
        {ready ? (
          <div className="flex gap-[10px] mt-[20px]">
            <button
              className="create-project-button h-[36px] py-0 px-[14px] border border-[#078153] rounded-control bg-[var(--color-accent-strong)] text-[#fff] cursor-pointer hover:bg-[#087f55] [transition:background_160ms_ease,border-color_160ms_ease,color_160ms_ease,transform_120ms_ease,box-shadow_160ms_ease,filter_160ms_ease] active:translate-y-[1px] active:scale-[0.99]"
              type="button"
              disabled={busy}
              onClick={() => void accept()}
            >
              {busy ? "Please wait..." : "Accept invitation"}
            </button>
            <button
              className="dashboard-secondary-button bg-[#1a181e] hover:bg-[#242129] min-h-[36px] py-0 px-[12px] border border-[#403c45] rounded-[7px] text-[#e8e5ed] [font:inherit] text-[12px]! cursor-pointer hover:border-[#696370] disabled:cursor-not-allowed disabled:opacity-[0.55] [transition:background_160ms_ease,border-color_160ms_ease,color_160ms_ease,transform_120ms_ease,box-shadow_160ms_ease,filter_160ms_ease] active:translate-y-[1] active:scale-[0.99]"
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
