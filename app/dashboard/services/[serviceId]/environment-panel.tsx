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
    <section className="dashboard-section mt-0 mb-[24px] mx-0 p-[20px] border border-[#27272a] rounded-card bg-[#0c0c0d] [@media(max-width:600px)]:p-[16px]" aria-labelledby="environment-heading">
      <div className="dashboard-section-heading flex min-h-[42px] items-center justify-between border-b border-b-[#322f37]">
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
        <p className="environment-redeploy-banner mx-0 px-[14px] border border-[#6b5a33] text-[#e8d49a] text-[13px] mt-0 mb-[16px] py-[10px] border-[rgba(245,158,11,0.3)] rounded-control bg-[rgba(245,158,11,0.08)] text-[#f5a623]" role="status">
          Environment changes are saved but not live yet. Redeploy this Service to apply them.
        </p>
      ) : null}

      {environment.error || actionError ? (
        <p className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error" role="alert">
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
                <label htmlFor="env-key-input" className="block text-[13px] font-medium text-[#c9c7d2] mb-[6px]">
                  Key
                </label>
                <input
                  id="env-key-input"
                  className="supabase-modal-input w-full h-[38px] py-0 px-[12px] rounded-control bg-[#1a1920] text-ink outline-none [transition:border-color_150ms]"
                  value={draft.key}
                  onChange={(event) => setDraft({ ...draft, key: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="API_TOKEN"
                  required
                />
              </div>
              <div>
                <label htmlFor="env-value-input" className="block text-[13px] font-medium text-[#c9c7d2] mb-[6px]">
                  {draft.mode === "edit" ? "New value (leave empty to keep)" : "Value"}
                </label>
                <input
                  id="env-value-input"
                  className="supabase-modal-input w-full h-[38px] py-0 px-[12px] rounded-control bg-[#1a1920] text-ink outline-none [transition:border-color_150ms]"
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
                className="supabase-btn-secondary font-medium focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] inline-flex items-center justify-center min-h-[38px] rounded-card border border-[#2a2834] bg-[#181720] [box-shadow:0_1px_2px_rgba(0,0,0,0.2)] whitespace-nowrap no-underline [transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease,color_120ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:border-[#3b3749] [&:hover:not(:disabled)]:bg-[#201e2a] [&:active:not(:disabled)]:translate-y-[1px] disabled:opacity-[0.5] disabled:transform-none"
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
        <p className="dashboard-table-empty text-[13px] p-[20px] text-[#71717a] text-center" role="status">
          Loading Environment Variables...
        </p>
      ) : variables.length === 0 ? (
        <div className="dashboard-empty-state px-[20px] text-center py-[32px] border border-dashed border-[#3f3f46] rounded-card bg-transparent">
          <h3>No Environment Variables</h3>
          <p>Add one to pass a secret, like an API token, into the Service container.</p>
        </div>
      ) : (
        <div className="organization-table-wrap overflow-x-auto border border-[#27272a] rounded-card bg-[#0c0c0d] [@media(max-width:720px)]:border-0 [@media(max-width:720px)]:rounded-[0] [@media(max-width:720px)]:bg-transparent">
          <table className="organization-table w-full text-left tabular-nums m-0 text-[13px]">
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
                      <code className="[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] text-[12px] tabular-nums">{variable.key}</code>
                    </td>
                    <td data-label="Value">
                      <code className="[font-family:ui-monospace,SFMono-Regular,Menlo,monospace] text-[12px] [overflow-wrap:anywhere] tabular-nums">
                        {isRevealed ? (revealed?.value ?? "") : variable.maskedValue}
                      </code>
                    </td>
                    <td data-label="Updated" className="svc-cell-wide">
                      {formatDateTime(variable.updatedAt)}
                    </td>
                    <td data-label="Actions" className="svc-cell-actions">
                      <div className="deployment-actions">
                        <button
                          className="dashboard-link-button text-[12px] focus-visible:outline-2 focus-visible:outline-[var(--color-violet)] focus-visible:outline-offset-[2px] p-0 border-0 text-violet [font:inherit] cursor-pointer hover:underline [transition:background_160ms_ease,border-color_160ms_ease,color_160ms_ease,transform_120ms_ease,box-shadow_160ms_ease,filter_160ms_ease]"
                          type="button"
                          onClick={() => void reveal(variable)}
                        >
                          {isRevealed ? "Hide" : "Reveal"}
                        </button>
                        <button
                          className="dashboard-link-button text-[12px] focus-visible:outline-2 focus-visible:outline-[var(--color-violet)] focus-visible:outline-offset-[2px] p-0 border-0 text-violet [font:inherit] cursor-pointer hover:underline [transition:background_160ms_ease,border-color_160ms_ease,color_160ms_ease,transform_120ms_ease,box-shadow_160ms_ease,filter_160ms_ease]"
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
                          className="dashboard-link-button text-[12px] focus-visible:outline-2 focus-visible:outline-[var(--color-violet)] focus-visible:outline-offset-[2px] p-0 border-0 text-violet [font:inherit] cursor-pointer hover:underline [transition:background_160ms_ease,border-color_160ms_ease,color_160ms_ease,transform_120ms_ease,box-shadow_160ms_ease,filter_160ms_ease] is-danger"
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
