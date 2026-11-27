"use client";

import { useState } from "react";
import {
  addServiceCustomDomain,
  deleteServiceCustomDomain,
  getServiceCustomDomain,
  verifyServiceCustomDomain,
  type CustomDomainSummary,
} from "@/lib/services-client";
import { getError, useResource } from "@/lib/resource";
import { formatDateTime } from "@/lib/format";
import { SupabaseModal } from "@/components/supabase-modal";

function statusLabel(status: CustomDomainSummary["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "failed":
      return "Verification failed";
    default:
      return "Pending verification";
  }
}

/**
 * The Service's optional Custom Domain. Owners and admins add the hostname,
 * publish the DNS records the panel shows, and verify once DNS propagates. The
 * Platform Subdomain keeps serving whether or not verification succeeds.
 */
export function CustomDomainPanel({
  serviceId,
  canManage,
}: {
  serviceId: string;
  canManage: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [hostname, setHostname] = useState("");
  // Add, verify, and delete failures share one slot next to the load error.
  const [actionError, setActionError] = useState("");

  const domain = useResource(() => getServiceCustomDomain(serviceId), [serviceId]);
  const domainData: CustomDomainSummary | null = domain.data;

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setActionError("");
    try {
      await addServiceCustomDomain(serviceId, hostname.trim());
      setHostname("");
      setAdding(false);
      await domain.refresh();
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setActionError("");
    try {
      // Verify returns the updated domain; adopt it without a round trip.
      domain.setData(await verifyServiceCustomDomain(serviceId));
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !window.confirm("Delete this Custom Domain? Its route and certificate status are removed.")
    ) {
      return;
    }

    setBusy(true);
    setActionError("");
    try {
      await deleteServiceCustomDomain(serviceId);
      domain.setData(null);
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dashboard-section mt-[26px]" aria-labelledby="custom-domain-heading">
      <div className="dashboard-section-heading flex min-h-[42px] items-center justify-between border-b border-b-[#322f37]">
        <h2 id="custom-domain-heading">Custom Domain</h2>
        {canManage && !domainData ? (
          <button
            className="supabase-btn-green"
            type="button"
            onClick={() => setAdding(true)}
            disabled={adding}
          >
            Add Custom Domain
          </button>
        ) : null}
      </div>

      {domain.error || actionError ? (
        <p className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error" role="alert">
          {domain.error || actionError}
        </p>
      ) : null}

      {adding ? (
        <SupabaseModal title="Add a custom domain" onClose={() => setAdding(false)}>
          <form onSubmit={add}>
            <div className="supabase-modal-body">
              <p className="text-sm text-zinc-400 mb-4">
                Point the hostname at the platform IP, then verify ownership with the TXT record
                shown after you add it.
              </p>
              <label htmlFor="domain-hostname-input" className="block text-[13px] font-medium text-[#c9c7d2] mb-[6px]">
                Hostname
              </label>
              <input
                id="domain-hostname-input"
                className="supabase-modal-input w-full h-[38px] py-0 px-[12px] rounded-control bg-[#1a1920] text-ink outline-none [transition:border-color_150ms]"
                value={hostname}
                onChange={(event) => setHostname(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="app.example.com"
                required
              />
            </div>
            <div className="supabase-modal-footer">
              <button
                type="button"
                className="supabase-btn-secondary font-medium focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] inline-flex items-center justify-center min-h-[38px] rounded-card border border-[#2a2834] bg-[#181720] [box-shadow:0_1px_2px_rgba(0,0,0,0.2)] whitespace-nowrap no-underline [transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease,color_120ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:border-[#3b3749] [&:hover:not(:disabled)]:bg-[#201e2a] [&:active:not(:disabled)]:translate-y-[1px] disabled:opacity-[0.5] disabled:transform-none"
                onClick={() => setAdding(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" className="supabase-btn-green" disabled={busy}>
                {busy ? "Saving..." : "Add domain"}
              </button>
            </div>
          </form>
        </SupabaseModal>
      ) : null}

      {domain.loading ? (
        <p className="dashboard-table-empty py-[14px] px-0 text-[#9e99a4] text-[13px]" role="status">
          Loading Custom Domain...
        </p>
      ) : !domainData ? (
        <div className="dashboard-empty-state py-[46px] px-[20px] border-b border-b-[#322f37] text-center">
          <h3>No Custom Domain</h3>
          <p>
            A Service can serve one domain you own in addition to its Platform Subdomain. You will
            prove control with a TXT record before HTTPS is enabled.
          </p>
        </div>
      ) : (
        <div className="custom-domain-details">
          <dl className="service-meta grid gap-[10px] mt-[16px] mb-0 mx-0 p-0">
            <div>
              <dt>Hostname</dt>
              <dd>{domainData.hostname}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{statusLabel(domainData.status)}</dd>
            </div>
            <div>
              <dt>Certificate</dt>
              <dd>
                {domainData.certificateStatus === "issued"
                  ? "Issued"
                  : domainData.certificateStatus === "failed"
                    ? "Not issued"
                    : "Waiting for verification"}
              </dd>
            </div>
            {domainData.verifiedAt ? (
              <div>
                <dt>Verified</dt>
                <dd>{formatDateTime(domainData.verifiedAt)}</dd>
              </div>
            ) : null}
          </dl>

          {domainData.lastError ? (
            <p className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error" role="alert">
              {domainData.lastError}
            </p>
          ) : null}

          <div className="custom-domain-records">
            <h3>DNS records</h3>
            <p>
              Add these records at your DNS provider, then verify. DNS changes can take a while.
            </p>
            <table className="organization-table w-full text-left tabular-nums svc-table-records">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Name</th>
                  <th scope="col">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-label="Type">TXT</td>
                  <td data-label="Name">
                    <code className="[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] text-[12px] tabular-nums">{domainData.instructions.txt.name}</code>
                  </td>
                  <td data-label="Value" className="svc-cell-wide">
                    <code className="[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] text-[12px] tabular-nums">{domainData.instructions.txt.value}</code>
                  </td>
                </tr>
                <tr>
                  <td data-label="Type">A</td>
                  <td data-label="Name">
                    <code className="[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] text-[12px] tabular-nums">{domainData.instructions.a.name}</code>
                  </td>
                  <td data-label="Value" className="svc-cell-wide">
                    {domainData.instructions.a.value ? (
                      <code className="[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] text-[12px] tabular-nums">{domainData.instructions.a.value}</code>
                    ) : (
                      <span>Not configured. Use the CNAME instead</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td data-label="Type">CNAME</td>
                  <td data-label="Name">
                    <code className="[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] text-[12px] tabular-nums">{domainData.instructions.cname.name}</code>
                  </td>
                  <td data-label="Value" className="svc-cell-wide">
                    <code className="[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] text-[12px] tabular-nums">{domainData.instructions.cname.value}</code>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {canManage ? (
            <div className="deployment-actions">
              <button
                className="supabase-btn-secondary font-medium focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] inline-flex items-center justify-center min-h-[38px] rounded-card border border-[#2a2834] bg-[#181720] [box-shadow:0_1px_2px_rgba(0,0,0,0.2)] whitespace-nowrap no-underline [transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease,color_120ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:border-[#3b3749] [&:hover:not(:disabled)]:bg-[#201e2a] [&:active:not(:disabled)]:translate-y-[1px] disabled:opacity-[0.5] disabled:transform-none"
                type="button"
                onClick={() => void verify()}
                disabled={busy}
              >
                {busy ? "Checking..." : "Verify DNS"}
              </button>
              <button
                className="dashboard-link-button text-[12px] focus-visible:outline-2 focus-visible:outline-[var(--color-violet)] focus-visible:outline-offset-[2px] p-0 border-0 text-violet [font:inherit] cursor-pointer hover:underline [transition:background_160ms_ease,border-color_160ms_ease,color_160ms_ease,transform_120ms_ease,box-shadow_160ms_ease,filter_160ms_ease] is-danger"
                type="button"
                onClick={() => void remove()}
                disabled={busy}
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
