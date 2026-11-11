"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addServiceCustomDomain,
  deleteServiceCustomDomain,
  getServiceCustomDomain,
  verifyServiceCustomDomain,
  type CustomDomainSummary,
} from "@/lib/custom-domains-client";

function getError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

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
  const [domain, setDomain] = useState<CustomDomainSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [hostname, setHostname] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await getServiceCustomDomain(serviceId);
      setDomain(result);
      setError("");
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await addServiceCustomDomain(serviceId, hostname.trim());
      setHostname("");
      setAdding(false);
      await load();
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError("");
    try {
      setDomain(await verifyServiceCustomDomain(serviceId));
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this Custom Domain? Its route and certificate status are removed.")) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      await deleteServiceCustomDomain(serviceId);
      setDomain(null);
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dashboard-section" aria-labelledby="custom-domain-heading">
      <div className="dashboard-section-heading">
        <h2 id="custom-domain-heading">Custom Domain</h2>
        {canManage && !domain ? (
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

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
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

      {loading ? (
        <p className="dashboard-table-empty" role="status">
          Loading Custom Domain...
        </p>
      ) : !domain ? (
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
              <dd>{domain.hostname}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{statusLabel(domain.status)}</dd>
            </div>
            <div>
              <dt>Certificate</dt>
              <dd>
                {domain.certificateStatus === "issued"
                  ? "Issued"
                  : domain.certificateStatus === "failed"
                    ? "Not issued"
                    : "Waiting for verification"}
              </dd>
            </div>
            {domain.verifiedAt ? (
              <div>
                <dt>Verified</dt>
                <dd>{formatTime(domain.verifiedAt)}</dd>
              </div>
            ) : null}
          </dl>

          {domain.lastError ? (
            <p className="dashboard-alert is-error" role="alert">
              {domain.lastError}
            </p>
          ) : null}

          <div className="custom-domain-records">
            <h3>DNS records</h3>
            <p>Add these records at your DNS provider, then verify. DNS changes can take a while.</p>
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
                    <code className="environment-key">{domain.instructions.txt.name}</code>
                  </td>
                  <td>
                    <code className="environment-key">{domain.instructions.txt.value}</code>
                  </td>
                </tr>
                <tr>
                  <td>A</td>
                  <td>
                    <code className="environment-key">{domain.instructions.a.name}</code>
                  </td>
                  <td>
                    {domain.instructions.a.value ? (
                      <code className="environment-key">{domain.instructions.a.value}</code>
                    ) : (
                      <span>Not configured. Use the CNAME instead</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td>CNAME</td>
                  <td>
                    <code className="environment-key">{domain.instructions.cname.name}</code>
                  </td>
                  <td>
                    <code className="environment-key">{domain.instructions.cname.value}</code>
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
