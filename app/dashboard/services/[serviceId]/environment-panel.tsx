"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createEnvironmentVariable,
  deleteEnvironmentVariable,
  listEnvironmentVariables,
  revealEnvironmentVariable,
  updateEnvironmentVariable,
  type EnvironmentVariableSummary,
} from "@/lib/environment-variables-client";

function getError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

type DraftState = {
  mode: "create" | "edit";
  variableId?: string;
  key: string;
  value: string;
  /** True once a value has been typed in edit mode, so an empty field keeps the old value. */
  valueTouched: boolean;
};

const EMPTY_DRAFT: DraftState = { mode: "create", key: "", value: "", valueTouched: false };

/**
 * Environment Variables for one Service. The values are always masked in the
 * table: the full value appears only after an explicit Reveal, and every
 * change here tells the user the Service needs a redeploy to pick it up.
 */
export function EnvironmentPanel({
  serviceId,
  needsRedeploy,
}: {
  serviceId: string;
  needsRedeploy: boolean;
}) {
  const [variables, setVariables] = useState<EnvironmentVariableSummary[]>([]);
  const [redeployNeeded, setRedeployNeeded] = useState(needsRedeploy);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; value: string } | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await listEnvironmentVariables(serviceId);
      setVariables(result.variables);
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

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      if (draft.mode === "create") {
        await createEnvironmentVariable(serviceId, { key: draft.key, value: draft.value });
      } else if (draft.variableId) {
        await updateEnvironmentVariable(serviceId, draft.variableId, {
          key: draft.key,
          ...(draft.valueTouched ? { value: draft.value } : {}),
        });
      }
      setDraft(null);
      await load();
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(variable: EnvironmentVariableSummary) {
    setBusy(true);
    setError("");
    try {
      await deleteEnvironmentVariable(serviceId, variable.id);
      setRevealed((current) => (current?.id === variable.id ? null : current));
      await load();
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function reveal(variable: EnvironmentVariableSummary) {
    setError("");
    // Revealing again collapses the value, so a secret is never left on screen.
    if (revealed?.id === variable.id) {
      setRevealed(null);
      return;
    }

    try {
      const result = await revealEnvironmentVariable(serviceId, variable.id);
      setRevealed({ id: result.id, value: result.value });
    } catch (cause) {
      setError(getError(cause));
    }
  }

  return (
    <section className="dashboard-section" aria-labelledby="environment-heading">
      <div className="dashboard-section-heading">
        <h2 id="environment-heading">Environment Variables</h2>
        <button
          className="create-project-button"
          type="button"
          onClick={() => setDraft(EMPTY_DRAFT)}
          disabled={draft?.mode === "create"}
        >
          Add variable
        </button>
      </div>

      {redeployNeeded ? (
        <p className="environment-redeploy-banner" role="status">
          Environment changes are saved but not live yet. Redeploy this Service to apply them.
        </p>
      ) : null}

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
        </p>
      ) : null}

      {draft ? (
        <form className="organization-settings-form environment-form" onSubmit={save}>
          <label>
            Key
            <input
              value={draft.key}
              onChange={(event) => setDraft({ ...draft, key: event.target.value })}
              autoComplete="off"
              spellCheck={false}
              placeholder="API_TOKEN"
              required
            />
          </label>
          <label>
            {draft.mode === "edit" ? "New value (leave empty to keep)" : "Value"}
            <input
              value={draft.value}
              onChange={(event) =>
                setDraft({ ...draft, value: event.target.value, valueTouched: true })
              }
              autoComplete="off"
              spellCheck={false}
              type="password"
            />
          </label>
          <div className="environment-form-actions">
            <button className="dashboard-secondary-button" type="submit" disabled={busy}>
              {busy ? "Saving..." : draft.mode === "create" ? "Add" : "Save"}
            </button>
            <button
              className="dashboard-link-button"
              type="button"
              onClick={() => setDraft(null)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <p className="dashboard-table-empty" role="status">
          Loading Environment Variables...
        </p>
      ) : variables.length === 0 ? (
        <div className="dashboard-empty-state">
          <h3>No Environment Variables</h3>
          <p>Add one to pass a secret, like an API token, into the Service container.</p>
        </div>
      ) : (
        <div className="organization-table-wrap">
          <table className="organization-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {variables.map((variable) => {
                const isRevealed = revealed?.id === variable.id;

                return (
                  <tr key={variable.id}>
                    <td>
                      <code className="environment-key">{variable.key}</code>
                    </td>
                    <td>
                      <code className="environment-value">
                        {isRevealed ? (revealed?.value ?? "") : variable.maskedValue}
                      </code>
                    </td>
                    <td>{formatTime(variable.updatedAt)}</td>
                    <td>
                      <div className="deployment-actions">
                        <button
                          className="dashboard-link-button"
                          type="button"
                          onClick={() => void reveal(variable)}
                        >
                          {isRevealed ? "Hide" : "Reveal"}
                        </button>
                        <button
                          className="dashboard-link-button"
                          type="button"
                          onClick={() =>
                            setDraft({
                              mode: "edit",
                              variableId: variable.id,
                              key: variable.key,
                              value: "",
                              valueTouched: false,
                            })
                          }
                          disabled={busy}
                        >
                          Edit
                        </button>
                        <button
                          className="dashboard-link-button is-danger"
                          type="button"
                          onClick={() => void remove(variable)}
                          disabled={busy}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
