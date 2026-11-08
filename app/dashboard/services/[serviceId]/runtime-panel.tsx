"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getServiceRuntime,
  runServiceAction,
  serviceRuntimeLabel,
  streamRuntimeLog,
  type ServiceRuntimeAction,
  type ServiceRuntimeState,
} from "@/lib/deployments-client";

const LOG_TAIL = 200;
const MAX_LOG_LINES = 500;

function getError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

/**
 * Runtime controls for one Service: stop, start, restart, and the live container
 * log. The container is never removed here, so stopping and starting a Service
 * keeps whatever data it wrote to its writable layer and Volumes.
 */
export function RuntimePanel({
  serviceId,
  canManage,
  hostname,
}: {
  serviceId: string;
  canManage: boolean;
  hostname: string;
}) {
  const [runtime, setRuntime] = useState<ServiceRuntimeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ServiceRuntimeAction | null>(null);
  const [error, setError] = useState("");
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [logError, setLogError] = useState("");
  const logRef = useRef<HTMLPreElement | null>(null);

  const load = useCallback(async () => {
    try {
      setRuntime(await getServiceRuntime(serviceId));
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

  async function act(action: ServiceRuntimeAction) {
    setBusy(action);
    setError("");
    try {
      setRuntime(await runServiceAction(serviceId, action));
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(null);
    }
  }

  // The log stream stays open while the panel is shown and is aborted when it
  // closes, so a Service that logs a lot does not keep a request open forever.
  useEffect(() => {
    if (!logOpen) return;

    const controller = new AbortController();

    void streamRuntimeLog(
      serviceId,
      LOG_TAIL,
      (line) => {
        setLogLines((current) => {
          const next = [...current, line];
          return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
        });
      },
      controller.signal,
    ).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setLogError(getError(cause));
      }
    });

    return () => controller.abort();
  }, [logOpen, serviceId]);

  // Keep the newest line visible as the container writes.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines]);

  const status = runtime?.status ?? "absent";
  const running = status === "running";

  return (
    <section className="dashboard-section" aria-labelledby="runtime-heading">
      <div className="dashboard-section-heading">
        <h2 id="runtime-heading">Runtime</h2>
        {canManage ? (
          <div className="runtime-actions">
            <button
              className="create-project-button"
              type="button"
              onClick={() => void act(running ? "stop" : "start")}
              disabled={busy !== null || loading || status === "absent"}
            >
              {busy === "stop" ? "Stopping..." : busy === "start" ? "Starting..." : running ? "Stop" : "Start"}
            </button>
            <button
              className="dashboard-link-button"
              type="button"
              onClick={() => void act("restart")}
              disabled={busy !== null || loading || !running}
            >
              {busy === "restart" ? "Restarting..." : "Restart"}
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
        </p>
      ) : null}

      <dl className="service-meta">
        <div>
          <dt>Container</dt>
          <dd>{loading ? "Checking..." : serviceRuntimeLabel(status)}</dd>
        </div>
        <div>
          <dt>Platform Subdomain</dt>
          <dd>
            {status === "running" ? (
              <a className="service-url" href={`https://${hostname}`} target="_blank" rel="noreferrer">
                https://{hostname}
              </a>
            ) : (
              <span>{hostname} (inactive)</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Container ID</dt>
          <dd>
            <code>{runtime?.containerId ? runtime.containerId.slice(0, 12) : "—"}</code>
          </dd>
        </div>
      </dl>

      {status === "absent" && !loading ? (
        <p className="dashboard-table-empty">
          This Service has no container yet. Deploy it to start one.
        </p>
      ) : null}

      <div className="deployment-log">
        <div className="deployment-log-head">
          <h3>Runtime log</h3>
          <button
            className="dashboard-link-button"
            type="button"
            onClick={() => {
              setLogError("");
              setLogOpen((open) => {
                if (open) setLogLines([]);
                return !open;
              });
            }}
            disabled={status === "absent"}
          >
            {logOpen ? "Stop following" : "Follow log"}
          </button>
        </div>
        {logError ? (
          <p className="dashboard-alert is-error" role="alert">
            {logError}
          </p>
        ) : null}
        {logOpen ? (
          <pre ref={logRef} aria-live="polite">
            {logLines.length > 0 ? logLines.join("\n") : "Waiting for output..."}
          </pre>
        ) : (
          <p className="dashboard-table-empty">Follow the log to see what the container writes.</p>
        )}
      </div>
    </section>
  );
}
