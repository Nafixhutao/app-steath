"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createServiceVolume,
  deleteServiceVolume,
  getServiceVolume,
  type VolumeSummary,
} from "@/lib/volumes-client";

function getError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

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
  const [volume, setVolume] = useState<VolumeSummary | null>(null);
  const [redeployNeeded, setRedeployNeeded] = useState(needsRedeploy);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mountPath, setMountPath] = useState("/data");
  const [sizeMb, setSizeMb] = useState(1024);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await getServiceVolume(serviceId);
      setVolume(result.volume);
      setRedeployNeeded(result.needsRedeploy);
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

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createServiceVolume(serviceId, { mountPath, sizeMb });
      setCreating(false);
      await load();
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this Volume and all the data stored in it?")) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      await deleteServiceVolume(serviceId);
      await load();
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dashboard-section" aria-labelledby="volume-heading">
      <div className="dashboard-section-heading">
        <h2 id="volume-heading">Volume</h2>
        {canManage && !volume ? (
          <button
            className="create-project-button"
            type="button"
            onClick={() => setCreating(true)}
            disabled={creating}
          >
            Add Volume
          </button>
        ) : null}
      </div>

      {redeployNeeded ? (
        <p className="environment-redeploy-banner" role="status">
          Volume changes are saved but not live yet. Redeploy this Service to apply them.
        </p>
      ) : null}

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
        </p>
      ) : null}

      {creating ? (
        <form className="organization-settings-form environment-form" onSubmit={create}>
          <label>
            Mount path
            <input
              value={mountPath}
              onChange={(event) => setMountPath(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="/data"
              required
            />
          </label>
          <label>
            Size (MB)
            <input
              value={sizeMb}
              onChange={(event) => setSizeMb(Number(event.target.value))}
              type="number"
              min={1}
              max={1024}
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
              onClick={() => setCreating(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <p className="dashboard-table-empty" role="status">
          Loading Volume...
        </p>
      ) : !volume ? (
        <div className="dashboard-empty-state">
          <h3>No Volume</h3>
          <p>
            A Volume keeps files across restarts and redeploys. Each Service can have one, up to 1
            GB.
          </p>
        </div>
      ) : (
        <div className="organization-table-wrap">
          <table className="organization-table">
            <thead>
              <tr>
                <th>Mount path</th>
                <th>Size</th>
                <th>Usage</th>
                <th>Created</th>
                {canManage ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code className="environment-key">{volume.mountPath}</code>
                </td>
                <td>{volume.sizeMb} MB</td>
                <td>
                  <div className="volume-usage">
                    <span>{usageLabel(volume)}</span>
                    {volume.exists && volume.usageMb !== null ? (
                      <span
                        className="volume-usage-bar"
                        aria-hidden="true"
                        style={{
                          width: `${Math.min(100, Math.round((volume.usageMb / volume.sizeMb) * 100))}%`,
                        }}
                      />
                    ) : null}
                  </div>
                </td>
                <td>{formatTime(volume.createdAt)}</td>
                {canManage ? (
                  <td>
                    <div className="deployment-actions">
                      <button
                        className="dashboard-link-button is-danger"
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
