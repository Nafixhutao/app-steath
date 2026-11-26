"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCw, ScrollText, X } from "lucide-react";
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
import { formatDateTime, formatRelative } from "@/lib/format";

const POLL_INTERVAL_MS = 3_000;

/** How many Deployments render before "Show older" is offered. */
const PAGE_SIZE = 10;

function shortCommit(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "N/A";
}

/**
 * Deployment history and Build log for one Service, laid out as one compact
 * row per Deployment. A Deployment in flight is polled so the status and log
 * update without the user reloading the page.
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<BuildLog | null>(null);
  const selectedRef = useRef<BuildLog | null>(null);
  const updateSelected = useCallback((log: BuildLog | null) => {
    selectedRef.current = log;
    setSelected(log);
  }, []);
  const [busy, setBusy] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);
  // Deploy, redeploy, and cancel failures share one slot next to the load error.
  const [actionError, setActionError] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);

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
      const current = selectedRef.current;
      if (!current || !isDeploymentActive(current.deployment.status)) return;
      const deploymentId = current.deployment.id;
      void getBuildLog(deploymentId)
        .then((log) => {
          // A newer selection (or Close) must not be overwritten by this poll.
          if (selectedRef.current?.deployment.id === deploymentId) updateSelected(log);
        })
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [active, refreshHistory, updateSelected]);

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

  async function toggleLog(deployment: DeploymentSummary) {
    if (expandedId === deployment.id) {
      setExpandedId(null);
      updateSelected(null);
      return;
    }

    setExpandedId(deployment.id);
    updateSelected(null);
    try {
      updateSelected(await getBuildLog(deployment.id));
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
  const visibleDeployments = deployments.slice(0, visible);
  const hiddenCount = deployments.length - visibleDeployments.length;

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
        <div className="overflow-hidden border border-[#27272a] rounded-card bg-[#0c0c0d]">
          <div className="deployment-list-head" aria-hidden="true">
            <span>Status</span>
            <span>Commit</span>
            <span>Started</span>
            <span>Duration</span>
            <span>Log</span>
            {canManage ? <span>Actions</span> : null}
          </div>

          <ul className="m-0 p-0 [list-style:none]">
            {visibleDeployments.map((deployment) => {
              const acting = actingOn === deployment.id;
              const open = expandedId === deployment.id;
              const logId = `deployment-log-${deployment.id}`;
              const redeployBlocked = acting || isDeploymentActive(latest?.status ?? "running");

              return (
                <li className="deployment-item" key={deployment.id}>
                  <div className={`deployment-row${open ? " is-open" : ""}`}>
                    <span className={`deployment-status is-${deployment.status}`}>
                      <span className="deployment-dot" aria-hidden="true" />
                      {deploymentStatusLabel(deployment.status)}
                    </span>
                    <code className="deployment-commit" title={deployment.commitSha ?? "N/A"}>
                      {shortCommit(deployment.commitSha)}
                    </code>
                    <span
                      className="deployment-when"
                      title={formatDateTime(deployment.startedAt ?? deployment.createdAt)}
                    >
                      {formatRelative(deployment.startedAt ?? deployment.createdAt)}
                    </span>
                    <span className="deployment-duration">
                      {deploymentDuration(deployment) ?? "N/A"}
                    </span>
                    <button
                      className="deployment-icon-btn"
                      type="button"
                      onClick={() => void toggleLog(deployment)}
                      aria-expanded={open}
                      aria-controls={logId}
                      aria-label={`${open ? "Hide" : "View"} build log for ${shortCommit(deployment.commitSha)}`}
                      title={open ? "Hide build log" : "View build log"}
                    >
                      <ScrollText size={15} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    {canManage ? (
                      <div className="deployment-row-actions">
                        <button
                          className="deployment-icon-btn"
                          type="button"
                          onClick={() => void redeploy(deployment)}
                          disabled={redeployBlocked}
                          aria-label={`Redeploy ${shortCommit(deployment.commitSha)}`}
                          title="Redeploy"
                        >
                          <RotateCw
                            size={15}
                            strokeWidth={1.8}
                            aria-hidden="true"
                            className={acting ? "animate-spin" : undefined}
                          />
                        </button>
                        {isDeploymentCancellable(deployment.status) ? (
                          <button
                            className="deployment-icon-btn is-danger"
                            type="button"
                            onClick={() => void cancel(deployment)}
                            disabled={acting}
                            aria-label={`Cancel ${shortCommit(deployment.commitSha)}`}
                            title="Cancel"
                          >
                            <X size={15} strokeWidth={2} aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {deployment.errorMessage ? (
                    <p className="deployment-row-error" title={deployment.errorMessage}>
                      {deployment.errorMessage}
                    </p>
                  ) : null}

                  {open ? (
                    <div className="deployment-detail" id={logId}>
                      <dl className="deployment-meta">
                        <div>
                          <dt>Started</dt>
                          <dd>{formatDateTime(deployment.startedAt)}</dd>
                        </div>
                        <div>
                          <dt>Finished</dt>
                          <dd>{formatDateTime(deployment.finishedAt)}</dd>
                        </div>
                        <div>
                          <dt>Duration</dt>
                          <dd>{deploymentDuration(deployment) ?? "N/A"}</dd>
                        </div>
                        <div>
                          <dt>Commit</dt>
                          <dd>
                            <code>{deployment.commitSha ?? "N/A"}</code>
                          </dd>
                        </div>
                      </dl>
                      <pre className="deployment-detail-log">
                        {selected
                          ? selected.lines.length > 0
                            ? selected.lines.join("\n")
                            : "No Build output yet."
                          : "Loading build log..."}
                      </pre>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {hiddenCount > 0 ? (
            <button
              className="deployment-show-older"
              type="button"
              onClick={() => setVisible((count) => count + PAGE_SIZE)}
            >
              Show older deployments ({hiddenCount})
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
