"use client";

import { useState } from "react";
import {
  addServiceCustomDomain,
  deleteServiceCustomDomain,
  getServiceCustomDomain,
  verifyServiceCustomDomain,
  type CustomDomainSummary,
} from "@/lib/custom-domains-client";
import { getError, useResource } from "@/lib/resource";
import { formatDateTime } from "@/lib/format";

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
    <section className="dashboard-section" aria-labelledby="custom-domain-heading">
      <div className="dashboard-section-heading">
        <h2 id="custom-domain-heading">Custom Domain</h2>
        {canManage && !domainData ? (
          <button
            className="create-project-button"
            type="button"
            onClick={() => setAdding(true)}
            disabled={adding}
          >
            Add Custom Domain
          </button>
        ) : null}
      </div>

      {domain.error || actionError ? (
        <p className="dashboard-alert is-error" role="alert">
          {domain.error || actionError}
        </p>
      ) : null}

      {adding ? (
        <form className="organization-settings-form environment-form" onSubmit={add}>
          <label>
            Hostname
            <input
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="app.example.com"
              required
            />
          </label>
          <div className="environment-form-actions">
            <button className="dashboard-secondary-button" type="submit" disabled={busy}>
              {busy ? "Saving..." : "Add"}
            </button>
            <button
              className="dashboard-link-button"
              type="button"
              onClick={() => setAdding(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {domain.loading ? (
        <p className="dashboard-table-empty" role="status">
          Loading Custom Domain...
        </p>
      ) : !domainData ? (
        <div className="dashboard-empty-state">
          <h3>No Custom Domain</h3>
          <p>
            A Service can serve one domain you own in addition to its Platform Subdomain. You will
            prove control with a TXT record before HTTPS is enabled.
          </p>
        </div>
      ) : (
        <div className="custom-domain-details">
          <dl className="service-meta">
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
            <p className="dashboard-alert is-error" role="alert">
              {domainData.lastError}
            </p>
          ) : null}

          <div className="custom-domain-records">
            <h3>DNS records</h3>
            <p>
              Add these records at your DNS provider, then verify. DNS changes can take a while.
            </p>
            <table className="organization-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>TXT</td>
                  <td>
                    <code className="environment-key">{domainData.instructions.txt.name}</code>
                  </td>
                  <td>
                    <code className="environment-key">{domainData.instructions.txt.value}</code>
                  </td>
                </tr>
                <tr>
                  <td>A</td>
                  <td>
                    <code className="environment-key">{domainData.instructions.a.name}</code>
                  </td>
                  <td>
                    {domainData.instructions.a.value ? (
                      <code className="environment-key">{domainData.instructions.a.value}</code>
                    ) : (
                      <span>Not configured. Use the CNAME instead</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td>CNAME</td>
                  <td>
                    <code className="environment-key">{domainData.instructions.cname.name}</code>
                  </td>
                  <td>
                    <code className="environment-key">{domainData.instructions.cname.value}</code>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {canManage ? (
            <div className="deployment-actions">
              <button
                className="dashboard-secondary-button"
                type="button"
                onClick={() => void verify()}
                disabled={busy}
              >
                {busy ? "Checking..." : "Verify DNS"}
              </button>
              <button
                className="dashboard-link-button is-danger"
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
