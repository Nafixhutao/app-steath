"use client";

import { useCallback, useState } from "react";
import {
  createServiceVolume,
  deleteServiceVolume,
  getServiceVolume,
  type VolumeSummary,
} from "@/lib/services-client";
import { getError, useResource } from "@/lib/resource";
import { formatDateTime } from "@/lib/format";
import { SupabaseModal } from "@/components/supabase-modal";

function usageLabel(volume: VolumeSummary): string {
  if (!volume.exists) {
    return "Created on the next Deployment";
  }
  if (volume.usageMb === null) {
    return "Unavailable: the node did not answer";
  }

  return `${volume.usageMb} MB of ${volume.sizeMb} MB`;
}

/**
 * The Service's one persistent Volume. Every role can see the mount path and the
 * usage the Node Agent measures; owners and admins can add or delete it. A Volume
 * change is not live until the next Deployment, so the panel repeats the
 * redeploy banner.
 */
export function VolumePanel({
  serviceId,
  needsRedeploy,
  canManage,
}: {
  serviceId: string;
  needsRedeploy: boolean;
  canManage: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mountPath, setMountPath] = useState("/data");
  const [sizeMb, setSizeMb] = useState(1024);
  // Create and delete failures share one slot next to the load error.
  const [actionError, setActionError] = useState("");

  const panel = useResource(
    useCallback(async () => {
      const result = await getServiceVolume(serviceId);
      return { volume: result.volume, needsRedeploy: result.needsRedeploy };
    }, [serviceId]),
    [serviceId],
  );
  const volume: VolumeSummary | null = panel.data?.volume ?? null;
  const redeployNeeded = panel.data?.needsRedeploy ?? needsRedeploy;
  const loading = panel.loading;

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setActionError("");
    try {
      await createServiceVolume(serviceId, { mountPath, sizeMb });
      setCreating(false);
      await panel.refresh();
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this Volume and all the data stored in it?")) {
      return;
    }

    setBusy(true);
    setActionError("");
    try {
      await deleteServiceVolume(serviceId);
      await panel.refresh();
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dashboard-section mt-[26px]" aria-labelledby="volume-heading">
      <div className="dashboard-section-heading flex min-h-[42px] items-center justify-between border-b border-b-[#322f37]">
        <h2 id="volume-heading">Volume</h2>
        {canManage && !volume ? (
          <button
            className="supabase-btn-green"
            type="button"
            onClick={() => setCreating(true)}
            disabled={creating}
          >
            Add Volume
          </button>
        ) : null}
      </div>

      {redeployNeeded ? (
        <p className="environment-redeploy-banner mt-[14px] mb-0 mx-0 py-[11px] px-[14px] border border-[#6b5a33] rounded-[9px] bg-[rgb(58_46_22_/_40%)] text-[#e8d49a] text-[13px]" role="status">
          Volume changes are saved but not live yet. Redeploy this Service to apply them.
        </p>
      ) : null}

      {panel.error || actionError ? (
        <p className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error" role="alert">
          {panel.error || actionError}
        </p>
      ) : null}

      {creating ? (
        <SupabaseModal title="Add a volume" onClose={() => setCreating(false)}>
          <form onSubmit={create}>
            <div className="supabase-modal-body">
              <p className="text-sm text-zinc-400 mb-4">
                A Volume keeps files across restarts and redeploys. The size is fixed until the next
                Deployment.
              </p>
              <div className="mb-4">
                <label htmlFor="volume-path-input" className="supabase-modal-label">
                  Mount path
                </label>
                <input
                  id="volume-path-input"
                  className="supabase-modal-input"
                  value={mountPath}
                  onChange={(event) => setMountPath(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="/data"
                  required
                />
              </div>
              <div>
                <label htmlFor="volume-size-input" className="supabase-modal-label">
                  Size (MB)
                </label>
                <input
                  id="volume-size-input"
                  className="supabase-modal-input"
                  value={sizeMb}
                  onChange={(event) => setSizeMb(Number(event.target.value))}
                  type="number"
                  min={1}
                  max={1024}
                  required
                />
              </div>
            </div>
            <div className="supabase-modal-footer">
              <button
                type="button"
                className="supabase-btn-secondary inline-flex items-center justify-center min-h-[38px] rounded-card border border-[#2a2834] bg-[#181720] [box-shadow:0_1px_2px_rgba(0,0,0,0.2)] whitespace-nowrap no-underline [transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease,color_120ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:border-[#3b3749] [&:hover:not(:disabled)]:bg-[#201e2a] [&:active:not(:disabled)]:translate-y-[1px] disabled:opacity-[0.5] disabled:transform-none"
                onClick={() => setCreating(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" className="supabase-btn-green" disabled={busy}>
                {busy ? "Saving..." : "Add volume"}
              </button>
            </div>
          </form>
        </SupabaseModal>
      ) : null}

      {loading ? (
        <p className="dashboard-table-empty py-[14px] px-0 text-[#9e99a4] text-[13px]" role="status">
          Loading Volume...
        </p>
      ) : !volume ? (
        <div className="dashboard-empty-state py-[46px] px-[20px] border-b border-b-[#322f37] text-center">
          <h3>No Volume</h3>
          <p>
            A Volume keeps files across restarts and redeploys. Each Service can have one, up to 1
            GB.
          </p>
        </div>
      ) : (
        <div className="organization-table-wrap overflow-x-auto">
          <table className="organization-table w-full text-left tabular-nums">
            <thead>
              <tr>
                <th scope="col">Mount path</th>
                <th scope="col">Size</th>
                <th scope="col">Usage</th>
                <th scope="col">Created</th>
                {canManage ? <th scope="col">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td data-label="Mount path">
                  <code className="[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] text-[12px] tabular-nums">{volume.mountPath}</code>
                </td>
                <td data-label="Size">{volume.sizeMb} MB</td>
                <td data-label="Usage" className="svc-cell-wide">
                  <div className="flex flex-col gap-[6px] min-w-[140px]">
                    <span>{usageLabel(volume)}</span>
                    {volume.exists && volume.usageMb !== null ? (
                      <span
                        className="block h-[4px] rounded-[999px] bg-violet"
                        aria-hidden="true"
                        style={{
                          width: `${Math.min(100, Math.round((volume.usageMb / volume.sizeMb) * 100))}%`,
                        }}
                      />
                    ) : null}
                  </div>
                </td>
                <td data-label="Created" className="svc-cell-wide">
                  {formatDateTime(volume.createdAt)}
                </td>
                {canManage ? (
                  <td data-label="Actions" className="svc-cell-actions">
                    <div className="deployment-actions">
                      <button
                        className="dashboard-link-button p-0 border-0 text-violet [font:inherit] cursor-pointer hover:underline [transition:background_160ms_ease,border-color_160ms_ease,color_160ms_ease,transform_120ms_ease,box-shadow_160ms_ease,filter_160ms_ease] is-danger"
                        type="button"
                        onClick={() => void remove()}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
