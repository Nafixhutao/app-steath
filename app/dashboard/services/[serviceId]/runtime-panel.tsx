"use client";

import { useEffect, useRef, useState } from "react";
import {
  getServiceRuntime,
  runServiceAction,
  serviceRuntimeLabel,
  streamRuntimeLog,
  type ServiceRuntimeAction,
} from "@/lib/services-client";
import { getError, useResource } from "@/lib/resource";

const LOG_TAIL = 200;
const MAX_LOG_LINES = 500;

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
  const runtime = useResource(() => getServiceRuntime(serviceId), [serviceId]);
  const [busy, setBusy] = useState<ServiceRuntimeAction | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [logError, setLogError] = useState("");
  const logRef = useRef<HTMLPreElement | null>(null);

  async function act(action: ServiceRuntimeAction) {
    setBusy(action);
    try {
      // The action returns the new state; adopt it instead of refetching.
      runtime.setData(await runServiceAction(serviceId, action));
    } catch (cause) {
      console.error(cause);
      await runtime.refresh();
    } finally {
      setBusy(null);
    }
  }

  // The log stream stays open while the panel is shown and is aborted when it
  // closes, so a Service that logs a lot does not keep a request open forever.
  const loggedServiceRef = useRef<string | null>(null);

  useEffect(() => {
    if (!logOpen) return;

    const controller = new AbortController();

    void streamRuntimeLog(
      serviceId,
      LOG_TAIL,
      (line) => {
        setLogLines((current) => {
          // A new Service (or a fresh follow) starts a new log, never mixing
          // lines from the previous stream.
          const base = loggedServiceRef.current === serviceId ? current : [];
          loggedServiceRef.current = serviceId;
          const next = [...base, line];
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

  const status = runtime.data?.status ?? "absent";
  const running = status === "running";

  return (
    <section className="dashboard-section mt-0 mb-[24px] mx-0 p-[20px] border border-[#27272a] rounded-card bg-[#0c0c0d] [@media(max-width:600px)]:p-[16px]" aria-labelledby="runtime-heading">
      <div className="dashboard-section-heading flex min-h-[42px] items-center justify-between border-b border-b-[#322f37]">
        <h2 id="runtime-heading">Runtime</h2>
        {canManage ? (
          <div className="runtime-actions flex items-center gap-[8px] flex-wrap">
            <button
              className="supabase-btn-green"
              type="button"
              onClick={() => void act(running ? "stop" : "start")}
              disabled={busy !== null || runtime.loading || status === "absent"}
            >
              {busy === "stop"
                ? "Stopping..."
                : busy === "start"
                  ? "Starting..."
                  : running
                    ? "Stop"
                    : "Start"}
            </button>
            <button
              className="dashboard-link-button text-[12px] focus-visible:outline-2 focus-visible:outline-[var(--color-violet)] focus-visible:outline-offset-[2px] p-0 border-0 text-violet [font:inherit] cursor-pointer hover:underline [transition:background_160ms_ease,border-color_160ms_ease,color_160ms_ease,transform_120ms_ease,box-shadow_160ms_ease,filter_160ms_ease]"
              type="button"
              onClick={() => void act("restart")}
              disabled={busy !== null || runtime.loading || !running}
            >
              {busy === "restart" ? "Restarting..." : "Restart"}
            </button>
          </div>
        ) : null}
      </div>

      {runtime.error ? (
        <p className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error" role="alert">
          {runtime.error}
        </p>
      ) : null}

      <dl className="service-meta grid gap-[10px] p-0 gap-[20px_24px] m-0">
        <div>
          <dt>Container</dt>
          <dd>{runtime.loading ? "Checking..." : serviceRuntimeLabel(status)}</dd>
        </div>
        <div>
          <dt>Platform Subdomain</dt>
          <dd>
            {status === "running" ? (
              <a
                className="text-violet! text-[12px] no-underline [overflow-wrap:anywhere] hover:underline tabular-nums"
                href={`https://${hostname}`}
                target="_blank"
                rel="noreferrer"
              >
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
            <code>{runtime.data?.containerId ? runtime.data.containerId.slice(0, 12) : "N/A"}</code>
          </dd>
        </div>
      </dl>

      {status === "absent" && !runtime.loading ? (
        <p className="dashboard-table-empty text-[13px] p-[20px] text-[#71717a] text-center">
          This Service has no container yet. Deploy it to start one.
        </p>
      ) : null}

      <div className="deployment-log">
        <div className="deployment-log-head">
          <h3>Runtime log</h3>
          <button
            className="dashboard-link-button text-[12px] focus-visible:outline-2 focus-visible:outline-[var(--color-violet)] focus-visible:outline-offset-[2px] p-0 border-0 text-violet [font:inherit] cursor-pointer hover:underline [transition:background_160ms_ease,border-color_160ms_ease,color_160ms_ease,transform_120ms_ease,box-shadow_160ms_ease,filter_160ms_ease]"
            type="button"
            onClick={() => {
              setLogError("");
              if (!logOpen) {
                loggedServiceRef.current = null;
                setLogLines([]);
              }
              setLogOpen(!logOpen);
            }}
            disabled={status === "absent"}
          >
            {logOpen ? "Stop following" : "Follow log"}
          </button>
        </div>
        {logError ? (
          <p className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error" role="alert">
            {logError}
          </p>
        ) : null}
        {logOpen ? (
          <pre ref={logRef} aria-live="polite">
            {logLines.length > 0 ? logLines.join("\n") : "Waiting for output..."}
          </pre>
        ) : (
          <p className="dashboard-table-empty text-[13px] p-[20px] text-[#71717a] text-center">Follow the log to see what the container writes.</p>
        )}
      </div>
    </section>
  );
}
