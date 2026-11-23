"use client";

import { useCallback, useState } from "react";
import {
  createEnvironmentVariable,
  deleteEnvironmentVariable,
  listEnvironmentVariables,
  revealEnvironmentVariable,
  updateEnvironmentVariable,
  type EnvironmentVariableSummary,
} from "@/lib/services-client";
import { getError, useResource } from "@/lib/resource";
import { formatDateTime } from "@/lib/format";
import { SupabaseModal } from "@/components/supabase-modal";

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
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; value: string } | null>(null);
  // Save, remove, and reveal failures share one slot next to the load error.
  const [actionError, setActionError] = useState("");

  const environment = useResource(
    useCallback(async () => {
      const result = await listEnvironmentVariables(serviceId);
      return { variables: result.variables, needsRedeploy: result.needsRedeploy };
    }, [serviceId]),
    [serviceId],
  );
  const variables: EnvironmentVariableSummary[] = environment.data?.variables ?? [];
  const redeployNeeded = environment.data?.needsRedeploy ?? needsRedeploy;
  const loading = environment.loading;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setActionError("");
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
      await environment.refresh();
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(variable: EnvironmentVariableSummary) {
    setBusy(true);
    setActionError("");
    try {
      await deleteEnvironmentVariable(serviceId, variable.id);
      setRevealed((current) => (current?.id === variable.id ? null : current));
      await environment.refresh();
    } catch (cause) {
      setActionError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function reveal(variable: EnvironmentVariableSummary) {
    setActionError("");
    // Revealing again collapses the value, so a secret is never left on screen.
    if (revealed?.id === variable.id) {
      setRevealed(null);
      return;
    }

    try {
      const result = await revealEnvironmentVariable(serviceId, variable.id);
      setRevealed({ id: result.id, value: result.value });
    } catch (cause) {
      setActionError(getError(cause));
    }
  }

  return (
    <section className="dashboard-section" aria-labelledby="environment-heading">
      <div className="dashboard-section-heading">
        <h2 id="environment-heading">Environment Variables</h2>
        <button
          className="supabase-btn-green"
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

      {environment.error || actionError ? (
        <p className="dashboard-alert is-error" role="alert">
          {environment.error || actionError}
        </p>
      ) : null}

      {draft ? (
        <SupabaseModal
          title={draft.mode === "create" ? "Add environment variable" : "Edit environment variable"}
          onClose={() => setDraft(null)}
        >
          <form onSubmit={save}>
            <div className="supabase-modal-body">
              <p className="text-sm text-zinc-400 mb-4">
                Values are encrypted at rest and stay masked in the table. Redeploy the Service to
                apply changes.
              </p>
              <div className="mb-4">
                <label htmlFor="env-key-input" className="supabase-modal-label">
                  Key
                </label>
                <input
                  id="env-key-input"
                  className="supabase-modal-input"
                  value={draft.key}
                  onChange={(event) => setDraft({ ...draft, key: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="API_TOKEN"
                  required
                />
              </div>
              <div>
                <label htmlFor="env-value-input" className="supabase-modal-label">
                  {draft.mode === "edit" ? "New value (leave empty to keep)" : "Value"}
                </label>
                <input
                  id="env-value-input"
                  className="supabase-modal-input"
                  value={draft.value}
                  onChange={(event) =>
                    setDraft({ ...draft, value: event.target.value, valueTouched: true })
                  }
                  autoComplete="off"
                  spellCheck={false}
                  type="password"
                />
              </div>
            </div>
            <div className="supabase-modal-footer">
              <button
                type="button"
                className="supabase-btn-secondary"
                onClick={() => setDraft(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" className="supabase-btn-green" disabled={busy}>
                {busy ? "Saving..." : draft.mode === "create" ? "Add variable" : "Save changes"}
              </button>
            </div>
          </form>
        </SupabaseModal>
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
                <th scope="col">Key</th>
                <th scope="col">Value</th>
                <th scope="col">Updated</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {variables.map((variable) => {
                const isRevealed = revealed?.id === variable.id;

                return (
                  <tr key={variable.id}>
                    <td data-label="Key">
                      <code className="environment-key">{variable.key}</code>
                    </td>
                    <td data-label="Value">
                      <code className="environment-value">
                        {isRevealed ? (revealed?.value ?? "") : variable.maskedValue}
                      </code>
                    </td>
                    <td data-label="Updated" className="svc-cell-wide">
                      {formatDateTime(variable.updatedAt)}
                    </td>
                    <td data-label="Actions" className="svc-cell-actions">
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
