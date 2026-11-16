"use client";

import { useProvidersReadModel } from "../data/admin-read-model";
import { AdminHeader, AdminPageBody, Mono } from "../components/admin-panel";
import { AdminPanel, AdminPanelHeader } from "../components/admin-panel";
import { StatusBadge } from "../components/status-badge";
import { PanelRowsSkeleton } from "../components/admin-skeletons";

/**
 * Models & Providers — the server-owned, non-secret provider/model catalog.
 * Usage and provider health are not published by this endpoint, so this page
 * does not infer them from fixtures.
 */
export function ProvidersPage() {
  const read = useProvidersReadModel();
  const { providers, execution } = read.data;

  return (
    <AdminPageBody>
      <AdminHeader
        title="Models & Providers"
        subtitle="Provider endpoints and the model catalog configured for this instance."
      >
        {execution && (
          <StatusBadge
            tone={execution.ready ? "success" : "warning"}
            label={execution.ready ? "Execution ready" : "Queue only"}
          />
        )}
      </AdminHeader>

      {read.status === "pending" ? (
        <PanelRowsSkeleton rows={4} />
      ) : read.status === "error" ? (
        <p className="m-0 rounded-lg border border-[var(--projects-border)] bg-[#141416] px-4 py-8 text-center text-[13px] text-[var(--projects-danger)]">
          {read.error}
        </p>
      ) : providers.length === 0 ? (
        <p className="m-0 rounded-lg border border-[var(--projects-border)] bg-[#141416] px-4 py-8 text-center text-[13px] text-[var(--projects-muted)]">
          No Agent providers are configured.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {providers.map((provider) => (
            <AdminPanel key={provider.id}>
              <div className="flex items-center gap-2.5">
                <Mono className="text-[14px] font-semibold text-[var(--projects-text)]">
                  {provider.name}
                </Mono>
                <Mono className="ml-auto text-[11px] text-[var(--projects-muted)]">
                  {provider.models.length} model
                  {provider.models.length === 1 ? "" : "s"}
                </Mono>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {provider.models.map((model) => (
                  <Mono
                    key={model}
                    className="rounded-md border border-[var(--projects-border)] px-1.5 py-0.5 text-[11px] text-[var(--projects-muted)]"
                  >
                    {model}
                  </Mono>
                ))}
              </div>
            </AdminPanel>
          ))}
        </div>
      )}

      <AdminPanel>
        <AdminPanelHeader
          title="Execution boundary"
          subtitle="The catalog never implies that a trusted execution worker is installed."
        />
        <p className="m-0 rounded-lg border border-[var(--projects-border)] bg-[#0f0f11] p-3 text-[12.5px] leading-5 text-[var(--projects-muted)]">
          {execution?.message ??
            "Provider execution readiness is not available from the API."}
        </p>
      </AdminPanel>
    </AdminPageBody>
  );
}
