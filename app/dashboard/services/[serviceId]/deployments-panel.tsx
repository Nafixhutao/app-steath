"use client";

import { useEffect, useState } from "react";
import {
  cancelDeployment,
  deploymentDuration,
  deploymentStatusLabel,
  getBuildLog,
  isDeploymentActive,
  isDeploymentCancellable,
  listDeployments,
  listNodes,
  redeployDeployment,
  triggerDeployment,
  type BuildLog,
  type DeploymentSummary,
  type NodeSummary,
} from "@/lib/services-client";
import { getError, useResource } from "@/lib/resource";
import { formatDateTime } from "@/lib/format";

const POLL_INTERVAL_MS = 3_000;

function shortCommit(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "N/A";
}

/**
 * Deployment history and Build log for one Service. A Deployment in flight is
 * polled so the status and log update without the user reloading the page.
 */
export function DeploymentsPanel({
  serviceId,
  canDeploy,
  canManage,
}: {
  serviceId: string;
  canDeploy: boolean;
  canManage: boolean;
}) {
  const [selected, setSelected] = useState<BuildLog | null>(null);
  const [busy, setBusy] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);
  // Deploy, redeploy, and cancel failures share one slot next to the load error.
  const [actionError, setActionError] = useState("");

  const history = useResource(async () => {
    const [deployments, nodes] = await Promise.all([listDeployments(serviceId), listNodes()]);
    return { deployments, node: nodes[0] ?? null };
  }, [serviceId]);
  const deployments: DeploymentSummary[] = history.data?.deployments ?? [];
  const node: NodeSummary | null = history.data?.node ?? null;
  const loading = history.loading;

  // Poll only while something is moving, so an idle Service makes no requests.
  const active = deployments.some((deployment) => isDeploymentActive(deployment.status));
  const refreshHistory = history.refresh;
  useEffect(() => {
    if (!active) return;

    const timer = setInterval(() => {
      void refreshHistory();
      setSelected((current) => {
        if (!current || !isDeploymentActive(current.deployment.status)) return current;
        void getBuildLog(current.deployment.id)
          .then(setSelected)
          .catch(() => undefined);
        return current;
      });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [active, refreshHistory]);

  async function deploy() {
    setBusy(true);
    setActionError("");
    try {
      await triggerDeployment(serviceId);
      await history.refresh();
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function openLog(deployment: DeploymentSummary) {
    try {
      setSelected(await getBuildLog(deployment.id));
      setActionError("");
    } catch (cause) {
      setActionError(getError(cause));
    }
  }

  async function redeploy(deployment: DeploymentSummary) {
    setActingOn(deployment.id);
    setActionError("");
    try {
      await redeployDeployment(deployment.id);
      await history.refresh();
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setActingOn(null);
    }
  }

  async function cancel(deployment: DeploymentSummary) {
    setActingOn(deployment.id);
    setActionError("");
    try {
      await cancelDeployment(deployment.id);
      await history.refresh();
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setActingOn(null);
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
            className="supabase-btn-green"
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
          <span className="deployment-node-name">
            Node <strong>{node.name}</strong>
          </span>
          <span className="deployment-node-state">
            {nodeHealthy ? "healthy" : "unavailable, Deployments are blocked"}
          </span>
          {node.lastSeenAt ? (
            <span className="deployment-node-time">
              Last heartbeat {formatDateTime(node.lastSeenAt)}
            </span>
          ) : null}
        </p>
      ) : (
        <p className="deployment-node is-unknown">
          No Node Agent has reported in, so Deployments are blocked.
        </p>
      )}

      {history.error || actionError ? (
        <p className="dashboard-alert is-error" role="alert">
          {history.error || actionError}
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
                <th scope="col">Status</th>
                <th scope="col">Commit</th>
                <th scope="col">Started</th>
                <th scope="col">Finished</th>
                <th scope="col">Duration</th>
                <th scope="col">Build log</th>
                {canManage ? <th scope="col">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {deployments.map((deployment) => {
                const acting = actingOn === deployment.id;

                return (
                  <tr key={deployment.id}>
                    <td data-label="Status">
                      <span className={`role-label is-${deployment.status}`}>
                        {deploymentStatusLabel(deployment.status)}
                      </span>
                      {deployment.errorMessage ? (
                        <small className="deployment-error">{deployment.errorMessage}</small>
                      ) : null}
                    </td>
                    <td data-label="Commit">
                      <code>{shortCommit(deployment.commitSha)}</code>
                    </td>
                    <td data-label="Started" className="svc-cell-wide">
                      {formatDateTime(deployment.startedAt)}
                    </td>
                    <td data-label="Finished" className="svc-cell-wide">
                      {formatDateTime(deployment.finishedAt)}
                    </td>
                    <td data-label="Duration">{deploymentDuration(deployment) ?? "N/A"}</td>
                    <td data-label="Build log">
                      <button
                        className="dashboard-link-button"
                        type="button"
                        onClick={() => void openLog(deployment)}
                      >
                        View log
                      </button>
                    </td>
                    {canManage ? (
                      <td data-label="Actions" className="svc-cell-actions">
                        <div className="deployment-actions">
                          <button
                            className="dashboard-link-button"
                            type="button"
                            onClick={() => void redeploy(deployment)}
                            disabled={acting || isDeploymentActive(latest?.status ?? "running")}
                          >
                            {acting ? "Working..." : "Redeploy"}
                          </button>
                          {isDeploymentCancellable(deployment.status) ? (
                            <button
                              className="dashboard-link-button is-danger"
                              type="button"
                              onClick={() => void cancel(deployment)}
                              disabled={acting}
                            >
                              Cancel
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
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
          <pre>
            {selected.lines.length > 0 ? selected.lines.join("\n") : "No Build output yet."}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
