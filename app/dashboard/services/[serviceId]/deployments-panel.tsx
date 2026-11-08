"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deploymentStatusLabel,
  getBuildLog,
  isDeploymentActive,
  listDeployments,
  listNodes,
  triggerDeployment,
  type BuildLog,
  type DeploymentSummary,
  type NodeSummary,
} from "@/lib/deployments-client";

const POLL_INTERVAL_MS = 3_000;

function getError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function shortCommit(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "—";
}

/**
 * Deployment history and Build log for one Service. A Deployment in flight is
 * polled so the status and log update without the user reloading the page.
 */
export function DeploymentsPanel({
  serviceId,
  canDeploy,
}: {
  serviceId: string;
  canDeploy: boolean;
}) {
  const [deployments, setDeployments] = useState<DeploymentSummary[]>([]);
  const [node, setNode] = useState<NodeSummary | null>(null);
  const [selected, setSelected] = useState<BuildLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [history, nodes] = await Promise.all([listDeployments(serviceId), listNodes()]);
      setDeployments(history);
      setNode(nodes[0] ?? null);
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

  // Poll only while something is moving, so an idle Service makes no requests.
  const active = deployments.some((deployment) => isDeploymentActive(deployment.status));
  useEffect(() => {
    if (!active) return;

    const timer = setInterval(() => {
      void load();
      setSelected((current) => {
        if (!current || !isDeploymentActive(current.deployment.status)) return current;
        void getBuildLog(current.deployment.id)
          .then(setSelected)
          .catch(() => undefined);
        return current;
      });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [active, load]);

  async function deploy() {
    setBusy(true);
    setError("");
    try {
      const deployment = await triggerDeployment(serviceId);
      setDeployments((current) => [deployment, ...current]);
      await load();
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function openLog(deployment: DeploymentSummary) {
    try {
      setSelected(await getBuildLog(deployment.id));
      setError("");
    } catch (cause) {
      setError(getError(cause));
    }
  }

  const nodeHealthy = node?.status === "healthy";
  const latest = deployments[0];

  return (
    <section className="dashboard-section" aria-labelledby="deployments-heading">
      <div className="dashboard-section-heading">
        <h2 id="deployments-heading">Deployments</h2>
        {canDeploy ? (
          <button
            className="create-project-button"
            type="button"
            onClick={deploy}
            disabled={busy || !nodeHealthy || (latest ? isDeploymentActive(latest.status) : false)}
          >
            {busy ? "Starting..." : "Deploy"}
          </button>
        ) : null}
      </div>

      {node ? (
        <p className={`deployment-node is-${node.status}`}>
          Node <strong>{node.name}</strong>:{" "}
          {nodeHealthy ? "healthy" : "unavailable — Deployments are blocked"}
          {node.lastSeenAt ? ` (last heartbeat ${formatTime(node.lastSeenAt)})` : null}
        </p>
      ) : (
        <p className="deployment-node is-unknown">
          No Node Agent has reported in, so Deployments are blocked.
        </p>
      )}

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="dashboard-table-empty" role="status">
          Loading Deployments...
        </p>
      ) : deployments.length === 0 ? (
        <div className="dashboard-empty-state">
          <h3>No Deployments yet</h3>
          <p>Deploy this Service to build its image from the repository.</p>
        </div>
      ) : (
        <div className="organization-table-wrap">
          <table className="organization-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Commit</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Build log</th>
              </tr>
            </thead>
            <tbody>
              {deployments.map((deployment) => (
                <tr key={deployment.id}>
                  <td>
                    <span className={`role-label is-${deployment.status}`}>
                      {deploymentStatusLabel(deployment.status)}
                    </span>
                    {deployment.errorMessage ? (
                      <small className="deployment-error">{deployment.errorMessage}</small>
                    ) : null}
                  </td>
                  <td>
                    <code>{shortCommit(deployment.commitSha)}</code>
                  </td>
                  <td>{formatTime(deployment.startedAt)}</td>
                  <td>{formatTime(deployment.finishedAt)}</td>
                  <td>
                    <button
                      className="dashboard-link-button"
                      type="button"
                      onClick={() => void openLog(deployment)}
                    >
                      View log
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <div className="deployment-log" aria-live="polite">
          <div className="deployment-log-head">
            <h3>Build log</h3>
            <button
              className="dashboard-link-button"
              type="button"
              onClick={() => setSelected(null)}
            >
              Close
            </button>
          </div>
          <pre>{selected.lines.length > 0 ? selected.lines.join("\n") : "No Build output yet."}</pre>
        </div>
      ) : null}
    </section>
  );
}
