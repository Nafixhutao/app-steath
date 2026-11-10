"use client";

import { useCallback, useEffect, useState } from "react";

type Report = {
  id: string;
  targetUrl: string;
  category: string;
  description: string;
  reporterEmail: string | null;
  status: string;
  createdAt: string;
};
type Resource = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  suspendedAt: string | null;
  serviceId: string | null;
  serviceName: string | null;
  platformHostname: string | null;
  status: string | null;
};
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed.");
  return body.data as T;
}

export function AbuseAdminPanel() {
  const [reports, setReports] = useState<Report[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const refreshReports = useCallback(async () => {
    try {
      setReports(await json<Report[]>("/api/admin/abuse-reports"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load reports.");
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(refreshReports);
  }, [refreshReports]);
  async function status(id: string, value: string) {
    try {
      await json(`/api/admin/abuse-reports/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: value }),
      });
      await refreshReports();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    }
  }
  async function search(event: React.FormEvent) {
    event.preventDefault();
    try {
      setResources(await json<Resource[]>(`/api/admin/resources?q=${encodeURIComponent(query)}`));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    }
  }
  async function suspend(
    kind: "services" | "organizations",
    id: string,
    action: "suspend" | "unsuspend",
  ) {
    try {
      await json(`/api/admin/suspensions/${kind}/${id}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      if (query.length >= 2)
        setResources(await json<Resource[]>(`/api/admin/resources?q=${encodeURIComponent(query)}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    }
  }
  return (
    <div className="dashboard-content">
      <div className="dashboard-page-heading">
        <div>
          <h1>Abuse reports</h1>
          <p>Review public reports and manage Services across Organizations.</p>
        </div>
        <button className="dashboard-link-button" onClick={() => void refreshReports()}>
          Refresh
        </button>
      </div>
      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="dashboard-section">
        <h2>Report queue</h2>
        {reports.length ? (
          <div className="organization-table-wrap">
            <table className="organization-table">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Reporter</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td>
                      <a href={report.targetUrl} target="_blank" rel="noreferrer">
                        {report.targetUrl}
                      </a>
                      <small>{new Date(report.createdAt).toLocaleString()}</small>
                    </td>
                    <td>{report.category}</td>
                    <td>{report.description}</td>
                    <td>{report.reporterEmail ?? "Anonymous"}</td>
                    <td>{report.status}</td>
                    <td>
                      <select
                        aria-label={`Status for report ${report.id}`}
                        value={report.status}
                        onChange={(e) => void status(report.id, e.target.value)}
                      >
                        <option value="new">New</option>
                        <option value="triaged">Triaged</option>
                        <option value="resolved">Resolved</option>
                        <option value="dismissed">Dismissed</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No reports.</p>
        )}
      </section>
      <section className="dashboard-section">
        <h2>Cross-tenant search</h2>
        <form onSubmit={search}>
          <label>
            Organization or Service
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              minLength={2}
              maxLength={100}
            />
          </label>
          <button type="submit">Search</button>
        </form>
        {resources.map((r, i) => (
          <article className="dashboard-card" key={`${r.organizationId}-${r.serviceId ?? i}`}>
            <strong>{r.organizationName}</strong> ({r.organizationSlug}){" "}
            {r.suspendedAt ? "— Organization suspended" : ""}
            <button
              onClick={() =>
                void suspend(
                  "organizations",
                  r.organizationId,
                  r.suspendedAt ? "unsuspend" : "suspend",
                )
              }
            >
              {r.suspendedAt ? "Unsuspend Organization" : "Suspend Organization"}
            </button>
            {r.serviceId ? (
              <p>
                {r.serviceName} · {r.platformHostname} · {r.status}
                <button
                  onClick={() =>
                    void suspend(
                      "services",
                      r.serviceId!,
                      r.status === "suspended" ? "unsuspend" : "suspend",
                    )
                  }
                >
                  {r.status === "suspended" ? "Unsuspend Service" : "Suspend Service"}
                </button>
              </p>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  );
}
