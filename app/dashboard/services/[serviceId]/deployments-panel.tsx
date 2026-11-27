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
    <section className="dashboard-section mt-0 mb-[24px] mx-0 p-[20px] border border-[#27272a] rounded-card bg-[#0c0c0d] [@media(max-width:600px)]:p-[16px]" aria-labelledby="deployments-heading">
      <div className="dashboard-section-heading flex min-h-[42px] items-center justify-between border-b border-b-[#322f37]">
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
        <p className={`deployment-node mt-0 mx-0 is-${node.status} flex items-center flex-wrap gap-[4px_8px] w-[fit-content] max-w-[100%] mb-[16px] py-[7px] px-[12px] border rounded-card bg-transparent text-[12.5px] leading-[1.5] ${node.status === "healthy" ? "border-[rgba(0,176,107,0.35)] text-[#00e08c] [&_strong]:text-[#00e08c]" : node.status === "unhealthy" ? "border-[#3f3f46] text-[#f0b366]" : node.status === "unknown" ? "border-[rgba(239,68,68,0.35)] text-[#f87171]" : "border-[#3f3f46] text-[#71717a]"}`}>
          <span className="deployment-node-name whitespace-nowrap">
            Node <strong className="text-[#d4d4d8] font-medium whitespace-nowrap">{node.name}</strong>
          </span>
          <span className="deployment-node-state font-medium">
            {nodeHealthy ? "healthy" : "unavailable, Deployments are blocked"}
          </span>
          {node.lastSeenAt ? (
            <span className="deployment-node-time opacity-[0.75]">
              Last heartbeat {formatDateTime(node.lastSeenAt)}
            </span>
          ) : null}
        </p>
      ) : (
        <p className="deployment-node mt-0 mx-0 is-unknown flex items-center flex-wrap gap-[4px_8px] w-[fit-content] max-w-[100%] mb-[16px] py-[7px] px-[12px] border border-[rgba(239,68,68,0.35)] rounded-card bg-transparent text-[#f87171] text-[12.5px] leading-[1.5]">
          No Node Agent has reported in, so Deployments are blocked.
        </p>
      )}

      {history.error || actionError ? (
        <p className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error" role="alert">
          {history.error || actionError}
        </p>
      ) : null}

      {loading ? (
        <p className="dashboard-table-empty text-[13px] p-[20px] text-[#71717a] text-center" role="status">
          Loading Deployments...
        </p>
      ) : deployments.length === 0 ? (
        <div className="dashboard-empty-state px-[20px] text-center py-[32px] border border-dashed border-[#3f3f46] rounded-card bg-transparent">
          <h3>No Deployments yet</h3>
          <p>Deploy this Service to build its image from the repository.</p>
        </div>
      ) : (
        <div className="overflow-hidden border border-[#27272a] rounded-card bg-[#0c0c0d]">
          <div className="deployment-list-head grid grid-cols-[116px_92px_minmax(0,1fr)_74px_44px_68px] [@media(max-width:720px)]:hidden gap-[12px] py-[9px] px-[14px] border-b border-b-[#27272a] bg-[#111113] text-[#71717a] text-[11px] font-medium tracking-[0.02em] uppercase" aria-hidden="true">
            <span>Status</span>
            <span>Commit</span>
            <span>Started</span>
            <span>Duration</span>
            <span>Log</span>
            {canManage ? <span>Actions</span> : null}
          </div>

          <ul className="m-0 p-0 [list-style:none] [&>li+li]:border-t [&>li+li]:border-t-[#1c1c20]">
            {visibleDeployments.map((deployment) => {
              const acting = actingOn === deployment.id;
              const open = expandedId === deployment.id;
              const logId = `deployment-log-${deployment.id}`;
              const redeployBlocked = acting || isDeploymentActive(latest?.status ?? "running");
              const statusTone =
                deployment.status === "running"
                  ? "text-[#00e08c]"
                  : deployment.status === "failed"
                    ? "text-[#f87171]"
                    : ["queued", "building", "deploying"].includes(deployment.status)
                      ? "text-[#f5a623]"
                      : "text-ink-muted";
              const statusPulse = ["queued", "building", "deploying"].includes(deployment.status)
                ? "animate-[deployment-pulse_1.4s_ease-in-out_infinite]"
                : "";

              return (
                <li className="deployment-item" key={deployment.id}>
                  <div className={`deployment-row grid-cols-[116px_92px_minmax(0,1fr)_74px_44px_68px] [@media(max-width:720px)]:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] [@media(max-width:720px)]:gap-[8px] [@media(max-width:720px)]:min-h-[52px] [@media(max-width:720px)]:py-0 [@media(max-width:720px)]:px-[12px] grid items-center gap-[12px] min-h-[44px] py-0 px-[14px] [transition:background-color_120ms_ease] hover:bg-[#111113]${open ? " bg-[#111113]" : ""}`}>
                    <span className={`deployment-status inline-flex items-center gap-[7px] text-[12.5px] font-medium whitespace-nowrap is-${deployment.status} ${statusTone}`}>
                      <span className={`deployment-dot w-[7px] h-[7px] rounded-[999px] bg-current [box-shadow:0_0_0_3px_rgb(255_255_255_/_4%)] ${statusPulse}`} aria-hidden="true" />
                      {deploymentStatusLabel(deployment.status)}
                    </span>
                    <code className="text-[#d4d4d8] [font-family:ui-monospace,SFMono-Regular,Menlo,monospace] text-[12px]" title={deployment.commitSha ?? "N/A"}>
                      {shortCommit(deployment.commitSha)}
                    </code>
                    <span
                      className="deployment-when min-w-0 overflow-hidden text-ink-muted text-[12px] text-ellipsis whitespace-nowrap [@media(max-width:720px)]:text-right"
                      title={formatDateTime(deployment.startedAt ?? deployment.createdAt)}
                    >
                      {formatRelative(deployment.startedAt ?? deployment.createdAt)}
                    </span>
                    <span className="deployment-duration text-ink-muted text-[12px] tabular-nums [@media(max-width:720px)]:hidden">
                      {deploymentDuration(deployment) ?? "N/A"}
                    </span>
                    <button
                      className="deployment-icon-btn focus-visible:outline-2 focus-visible:outline-[#fafafa] focus-visible:outline-offset-[1px] inline-flex w-[28px] h-[28px] items-center justify-center border border-transparent rounded-control bg-transparent text-ink-muted cursor-pointer [&:hover:not(:disabled)]:bg-[#1c1c20] [&:hover:not(:disabled)]:text-[#fafafa] disabled:opacity-[0.4] disabled:cursor-not-allowed"
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
                      <div className="flex gap-[2px] justify-end">
                        <button
                          className="deployment-icon-btn focus-visible:outline-2 focus-visible:outline-[#fafafa] focus-visible:outline-offset-[1px] inline-flex w-[28px] h-[28px] items-center justify-center border border-transparent rounded-control bg-transparent text-ink-muted cursor-pointer [&:hover:not(:disabled)]:bg-[#1c1c20] [&:hover:not(:disabled)]:text-[#fafafa] disabled:opacity-[0.4] disabled:cursor-not-allowed"
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
                            className="deployment-icon-btn focus-visible:outline-2 focus-visible:outline-[#fafafa] focus-visible:outline-offset-[1px] inline-flex w-[28px] h-[28px] items-center justify-center border border-transparent rounded-control bg-transparent text-ink-muted cursor-pointer [&:hover:not(:disabled)]:bg-[#1c1c20] [&:hover:not(:disabled)]:text-[#fafafa] disabled:opacity-[0.4] disabled:cursor-not-allowed is-danger"
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
                    <p className="deployment-row-error [@media(max-width:720px)]:pt-0 [@media(max-width:720px)]:pb-[9px] [@media(max-width:720px)]:px-[12px] m-0 pt-0 pb-[9px] px-[14px] overflow-hidden text-[#f87171] text-[12px] text-ellipsis whitespace-nowrap" title={deployment.errorMessage}>
                      {deployment.errorMessage}
                    </p>
                  ) : null}

                  {open ? (
                    <div className="deployment-detail [@media(max-width:720px)]:pt-0 [@media(max-width:720px)]:pb-[12px] [@media(max-width:720px)]:px-[12px] pt-0 pb-[14px] px-[14px] border-t border-t-[#1c1c20] bg-[#111113]" id={logId}>
                      <dl className="deployment-meta flex flex-wrap gap-[6px_24px] m-0 py-[10px] px-0 text-[12px] [&>div]:flex [&>div]:gap-[6px] [&_dt]:text-[#71717a] [&_dd]:m-0 [&_dd]:text-[#d4d4d8] [&_code]:text-[11.5px]">
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
                      <pre className="max-h-[320px] m-0 p-[12px] overflow-auto border border-[#27272a] rounded-control bg-[#09090b] text-[#c8c8ce] [font-family:ui-monospace,SFMono-Regular,Menlo,monospace] text-[11.5px] leading-[1.6] whitespace-pre-wrap [overflow-wrap:anywhere]">
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
              className="w-full p-[11px] border-t border-t-[#27272a] bg-[#111113] text-ink-muted text-[12px]! cursor-pointer hover:text-[#fafafa]"
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
