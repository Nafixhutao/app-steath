"use client";

import { useState } from "react";
import { CircleAlert, Loader2, Trash2 } from "lucide-react";
import { useAdminOAuthProviders } from "@/features/admin/data/admin-read-model";
import {
  useDeleteAdminOAuthProvider,
  useUpdateAdminOAuthProvider,
  type OAuthProviderName,
} from "@/features/admin/data/admin-mutations";
import { errorMessage } from "@/components/feedback/error-state";
import { AdminPanel, AdminPanelHeader } from "../components/admin-panel";
import { ProviderCardsSkeleton } from "../components/admin-skeletons";
import { CopyButton } from "@/components/copy-button";
import { StatusBadge } from "../components/status-badge";

const fieldClass =
  "h-10 w-full rounded-md border border-[var(--projects-border)] bg-[var(--projects-control)] px-3 text-[13px] leading-4 text-[var(--projects-text)] outline-none transition-colors focus:border-[var(--projects-border-hover)]";
const labelClass =
  "mb-1.5 block text-[12px] font-medium text-[var(--projects-muted)]";

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  google: "Google",
};

/** Where a provider's active credentials come from. */
type ProviderSource = "database" | "environment" | "none";

/**
 * External sign-in providers. Real settings backed by the API: the owner saves
 * a client ID and secret, and the API stores the secret encrypted. The
 * callback URL shown here must be registered with the provider.
 */
export function SignInProvidersPanel() {
  const query = useAdminOAuthProviders();
  const providers = query.data?.providers ?? [];

  return (
    <AdminPanel className="lg:col-span-2">
      <AdminPanelHeader
        title="Sign-in providers"
        subtitle="Let people sign in with an external account. Secrets are encrypted at rest and never shown again."
      />
      {query.isPending ? (
        <ProviderCardsSkeleton />
      ) : query.error ? (
        <p
          role="alert"
          className="flex items-start gap-1.5 text-[12.5px] leading-4 text-[var(--projects-danger)]"
        >
          <CircleAlert size={13} strokeWidth={2} aria-hidden="true" />
          {errorMessage(query.error)}
        </p>
      ) : providers.length === 0 ? (
        <p className="text-[13px] text-[var(--projects-muted)]">
          No sign-in providers are available on this instance.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.provider}
              provider={String(provider.provider) as OAuthProviderName}
              label={PROVIDER_LABELS[provider.provider] ?? provider.provider}
              configured={provider.configured}
              source={String(provider.source) as ProviderSource}
              clientId={provider.client_id ?? ""}
              callbackUrl={provider.callback_url}
            />
          ))}
        </div>
      )}
    </AdminPanel>
  );
}

function ProviderCard({
  provider,
  label,
  configured,
  source,
  clientId,
  callbackUrl,
}: {
  provider: OAuthProviderName;
  label: string;
  configured: boolean;
  source: ProviderSource;
  clientId: string;
  callbackUrl: string;
}) {
  const update = useUpdateAdminOAuthProvider();
  const remove = useDeleteAdminOAuthProvider();
  // `draft` is null until the operator edits the field, so the input follows
  // the server value after a refetch instead of freezing the first render.
  const [draftClientId, setDraftClientId] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const clientIdValue = draftClientId ?? clientId;

  const pending = update.isPending || remove.isPending;
  const canSave = clientIdValue.trim().length > 0 && secret.trim().length > 0;
  const fromEnvironment = source === "environment";

  const save = () => {
    if (!canSave) return;
    update.mutate(
      {
        provider,
        body: {
          client_id: clientIdValue.trim(),
          client_secret: secret.trim(),
        },
      },
      {
        onSuccess: () => {
          // Drop the draft so the field reflects the saved server value.
          setDraftClientId(null);
          setSecret("");
        },
      },
    );
  };

  const clear = () => {
    remove.mutate(provider, {
      onSuccess: () => {
        setDraftClientId(null);
        setSecret("");
      },
    });
  };

  return (
    <div className="rounded-lg border border-[var(--projects-border)] bg-[var(--projects-control)] p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-[var(--projects-text)]">
          {label}
        </span>
        <StatusBadge
          tone={configured ? "success" : "neutral"}
          label={configured ? "Configured" : "Not configured"}
        />
      </div>

      {fromEnvironment ? (
        <p className="mb-3 rounded-md border border-[var(--admin-info)]/25 bg-[var(--admin-info)]/10 px-2.5 py-2 text-[11.5px] leading-4 text-[var(--projects-muted)]">
          Active credentials come from the deployment environment. Saving here
          replaces them for this instance.
        </p>
      ) : null}

      <label className="mb-3 block">
        <span className={labelClass}>Client ID</span>
        <input
          value={clientIdValue}
          onChange={(event) => setDraftClientId(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className={fieldClass}
        />
      </label>

      <label className="mb-3 block">
        <span className={labelClass}>
          Client secret{configured ? " (re-enter to change)" : ""}
        </span>
        <input
          type="password"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          autoComplete="new-password"
          placeholder={configured ? "••••••••" : ""}
          className={fieldClass}
        />
      </label>

      <div className="mb-3">
        <span className={labelClass}>Callback URL</span>
        <span className="flex items-center gap-1.5 rounded-md border border-[var(--projects-border)] bg-[var(--projects-bg)] px-2.5 py-1.5">
          <code className="admin-mono min-w-0 flex-1 truncate text-[11px] text-[var(--projects-muted)]">
            {callbackUrl}
          </code>
          <CopyButton text={callbackUrl} label={`Copy ${label} callback URL`} />
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || !canSave}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--projects-accent-border)] bg-[var(--projects-accent-strong)] px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[var(--projects-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {update.isPending ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : null}
          {update.isPending ? "Saving…" : "Save"}
        </button>
        {source === "database" ? (
          <button
            type="button"
            onClick={clear}
            disabled={pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--projects-border)] px-3 text-[12.5px] font-medium text-[var(--projects-muted)] transition-colors hover:border-[var(--projects-danger)] hover:text-[var(--projects-danger)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {remove.isPending ? (
              <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
            )}
            Remove
          </button>
        ) : null}
      </div>

      {update.error ? (
        <p
          role="alert"
          className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-4 text-[var(--projects-danger)]"
        >
          <CircleAlert size={12} strokeWidth={2} aria-hidden="true" />
          {errorMessage(update.error)}
        </p>
      ) : null}
      {remove.error ? (
        <p
          role="alert"
          className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-4 text-[var(--projects-danger)]"
        >
          <CircleAlert size={12} strokeWidth={2} aria-hidden="true" />
          {errorMessage(remove.error)}
        </p>
      ) : null}
    </div>
  );
}
