"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getScanFindings,
  type ScanFindingList,
  type ScanFindingSummary,
} from "@/lib/admin-client";

function getError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function severityClass(severity: string): string {
  if (severity === "critical" || severity === "high") return "failed";
  if (severity === "medium") return "pending";
  if (severity === "info" || severity === "unknown") return "pending";

  return "running";
}

function scannerLabel(scanner: string): string {
  return scanner === "clamav" ? "ClamAV" : "Trivy";
}

/**
 * The most useful detail a finding carries, shown under the title. The details
 * come from the scanners and never contain user secrets.
 */
function findingNote(finding: ScanFindingSummary): string | null {
  const details = finding.details ?? {};
  const kind = typeof details.kind === "string" ? details.kind : "";
  const pkg = details.package ?? details.ruleId ?? details.id ?? details.path;
  if (typeof pkg === "string" && pkg !== "") {
    return kind === "" ? pkg : `${kind}: ${pkg}`;
  }
  if (kind !== "") return kind;
  if (typeof details.error === "string") return details.error;

  return null;
}

/**
 * Platform Admin queue of ScanFindings across every Organization. Urgent
 * findings (high-severity malware) sort first; the urgent filter narrows the
 * queue to just those.
 */
export function FindingsPanel() {
  const [list, setList] = useState<ScanFindingList | null>(null);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await getScanFindings({ urgentOnly });
      setList(next);
      setError("");
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setLoading(false);
    }
  }, [urgentOnly]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  return (
    <div className="dashboard-content">
      <div className="dashboard-page-heading">
        <div>
          <h1>Scan findings</h1>
          <p>
            Image scan results across every Organization. Urgent findings are high-severity malware;
            findings never suspend a Service by themselves.
          </p>
        </div>
        <button className="dashboard-link-button" type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
        </p>
      ) : null}

      {list && list.urgent > 0 ? (
        <p className="dashboard-alert is-error" role="status">
          {list.urgent} urgent finding{list.urgent === 1 ? "" : "s"} need{list.urgent === 1 ? "s" : ""}{" "}
          attention.
        </p>
      ) : null}

      <p>
        <label>
          <input
            type="checkbox"
            checked={urgentOnly}
            onChange={(event) => setUrgentOnly(event.target.checked)}
          />{" "}
          Urgent only
        </label>
      </p>

      <section className="dashboard-section" aria-labelledby="findings-heading">
        <div className="dashboard-section-heading">
          <h2 id="findings-heading">Findings</h2>
        </div>

        {loading && !list ? (
          <div className="dashboard-empty-state">
            <p role="status">Loading findings...</p>
          </div>
        ) : !list || list.findings.length === 0 ? (
          <div className="dashboard-empty-state">
            <h3>No findings</h3>
            <p>
              Every scanned image is clean{list && list.total > 0 ? " in this view" : " so far"}.
            </p>
          </div>
        ) : (
          <div className="organization-table-wrap">
            <table className="organization-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Finding</th>
                  <th>Scanner</th>
                  <th>Organization</th>
                  <th>Project</th>
                  <th>Service</th>
                  <th>Image</th>
                  <th>Found</th>
                </tr>
              </thead>
              <tbody>
                {list.findings.map((finding) => (
                  <tr key={finding.id}>
                    <td>
                      <span className={`role-label is-${severityClass(finding.severity)}`}>
                        {finding.urgent ? "urgent " : ""}
                        {finding.severity}
                      </span>
                    </td>
                    <td>
                      <strong>{finding.title}</strong>
                      {findingNote(finding) ? (
                        <p className="project-quota-note">{findingNote(finding)}</p>
                      ) : null}
                    </td>
                    <td>{scannerLabel(finding.scanner)}</td>
                    <td>{finding.organizationName}</td>
                    <td>{finding.projectName}</td>
                    <td>{finding.serviceName}</td>
                    <td title={finding.imageRef ?? ""}>{finding.imageRef ?? "-"}</td>
                    <td>{formatTime(finding.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
