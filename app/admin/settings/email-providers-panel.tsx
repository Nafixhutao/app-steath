"use client";

import { useCallback, useState } from "react";
import { Check, CircleAlert, Loader2, RefreshCw, Send } from "lucide-react";
import {
  AdminHeader,
  AdminPageBody,
  AdminPanel,
  AdminPanelHeader,
  Mono,
} from "@/features/admin/components/admin-panel";
import { StatusBadge } from "@/features/admin/components/status-badge";
import { CopyButton } from "@/components/copy-button";
import { errorMessage } from "@/components/feedback/error-state";
import { getError, useResource } from "@/lib/resource";
import { formatDateTime } from "@/lib/format";
import {
  getEmailOutbox,
  getEmailProviders,
  retryEmail,
  sendTestEmail,
  updateEmailProvider,
  type EmailOutboxSummary,
  type EmailProviderSummary,
  type MailProviderId,
} from "@/lib/admin/email-client";

const fieldClass =
  "h-10 w-full rounded-md border border-[var(--projects-border)] bg-[var(--projects-control)] px-3 text-[13px] leading-4 text-[var(--projects-text)] outline-none transition-colors focus:border-[var(--projects-border-hover)]";
const labelClass = "mb-1.5 block text-[12px] font-medium text-[var(--projects-muted)]";

const PROVIDER_INFO: Record<MailProviderId, { name: string; quota: string; spf: string }> = {
  resend: {
    name: "Resend",
    quota: "3.000 email/bulan · 100/hari",
    spf: "include:resend.com",
  },
  mailjet: {
    name: "Mailjet",
    quota: "6.000 email/bulan · 200/hari",
    spf: "include:mailjet.com",
  },
};

type Draft = {
  enabled: boolean;
  priority: number;
  fromEmail: string;
  fromName: string;
  monthlyLimit: number;
  dailyLimit: number;
  apiKey: string;
  apiSecret: string;
};

function toDraft(provider: EmailProviderSummary): Draft {
  return {
    enabled: provider.enabled,
    priority: provider.priority,
    fromEmail: provider.fromEmail,
    fromName: provider.fromName,
    monthlyLimit: provider.monthlyLimit,
    dailyLimit: provider.dailyLimit,
    apiKey: "",
    apiSecret: "",
  };
}

function usageBar(used: number, limit: number): string {
  if (limit <= 0) return "0%";
  return `${Math.min(100, Math.round((used / limit) * 100))}%`;
}

function statusTone(status: EmailOutboxSummary["status"]) {
  if (status === "sent") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "sending") return "info" as const;
  return "warning" as const;
}

function ProviderCard({
  provider,
  onSaved,
}: {
  provider: EmailProviderSummary;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(provider));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const info = PROVIDER_INFO[provider.provider];

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setError("");
  }

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const input: Parameters<typeof updateEmailProvider>[1] = {
        enabled: draft.enabled,
        priority: draft.priority,
        fromEmail: draft.fromEmail,
        fromName: draft.fromName,
        monthlyLimit: draft.monthlyLimit,
        dailyLimit: draft.dailyLimit,
      };
      if (draft.apiKey.trim()) input.apiKey = draft.apiKey.trim();
      if (draft.apiSecret.trim()) input.apiSecret = draft.apiSecret.trim();
      await updateEmailProvider(provider.provider, input);
      setDraft((current) => ({ ...current, apiKey: "", apiSecret: "" }));
      setSaved(true);
      onSaved();
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPanel>
      <AdminPanelHeader
        title={info.name}
        subtitle={`Gratis: ${info.quota}. Prioritas lebih kecil dipakai lebih dulu.`}
        right={
          <StatusBadge
            tone={provider.enabled && provider.configured ? "success" : "neutral"}
            label={
              provider.enabled && provider.configured
                ? "Active"
                : provider.configured
                  ? "Ready"
                  : "Not configured"
            }
          />
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3.5">
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => set("enabled", event.target.checked)}
              className="mt-1 h-4 w-4 accent-[var(--projects-accent)]"
            />
            <span>
              <span className={labelClass}>Enable this provider</span>
              <span className="block text-[12px] text-[var(--projects-muted)]">
                Worker mengirim lewat provider aktif dengan prioritas terkecil yang masih punya
                kuota.
              </span>
            </span>
          </label>

          <label className="block">
            <span className={labelClass}>From email</span>
            <input
              type="email"
              value={draft.fromEmail}
              onChange={(event) => set("fromEmail", event.target.value)}
              className={fieldClass}
              placeholder="noreply@domain Anda"
            />
          </label>

          <label className="block">
            <span className={labelClass}>From name</span>
            <input
              value={draft.fromName}
              onChange={(event) => set("fromName", event.target.value)}
              className={fieldClass}
              placeholder="Stealth"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>Priority</span>
              <input
                type="number"
                min={1}
                max={9}
                value={draft.priority}
                onChange={(event) => set("priority", Number(event.target.value))}
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Monthly limit</span>
              <input
                type="number"
                min={1}
                value={draft.monthlyLimit}
                onChange={(event) => set("monthlyLimit", Number(event.target.value))}
                className={fieldClass}
              />
            </label>
          </div>
          <label className="block">
            <span className={labelClass}>Daily limit</span>
            <input
              type="number"
              min={1}
              value={draft.dailyLimit}
              onChange={(event) => set("dailyLimit", Number(event.target.value))}
              className={fieldClass}
            />
          </label>
        </div>

        <div className="space-y-3.5">
          <label className="block">
            <span className={labelClass}>
              {provider.provider === "resend" ? "Resend API key" : "Mailjet API key (public)"}
            </span>
            <input
              type="password"
              value={draft.apiKey}
              onChange={(event) => set("apiKey", event.target.value)}
              className={fieldClass}
              placeholder={
                provider.hasKey ? `${provider.keyPreview} (tersimpan)` : "re_xxx / public key"
              }
              autoComplete="off"
            />
          </label>

          {provider.provider === "mailjet" ? (
            <label className="block">
              <span className={labelClass}>Mailjet API secret (private)</span>
              <input
                type="password"
                value={draft.apiSecret}
                onChange={(event) => set("apiSecret", event.target.value)}
                className={fieldClass}
                placeholder={
                  provider.hasSecret ? `${provider.keyPreview} (tersimpan)` : "private key"
                }
                autoComplete="off"
              />
            </label>
          ) : null}

          <div className="rounded-lg border border-[var(--projects-border)] bg-[var(--projects-control)] px-3 py-2.5">
            <p className="mb-1.5 text-[12px] font-medium text-[var(--projects-muted)]">
              Pemakaian kuota lokal
            </p>
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-[11px] text-[var(--projects-muted)]">
                  <span>Bulan ini</span>
                  <Mono>{`${provider.usedMonth} / ${provider.monthlyLimit}`}</Mono>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--projects-border)]">
                  <div
                    className="h-full rounded-full bg-[var(--projects-accent)]"
                    style={{ width: usageBar(provider.usedMonth, provider.monthlyLimit) }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-[11px] text-[var(--projects-muted)]">
                  <span>Hari ini</span>
                  <Mono>{`${provider.usedDay} / ${provider.dailyLimit}`}</Mono>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--projects-border)]">
                  <div
                    className="h-full rounded-full bg-[var(--projects-accent)]"
                    style={{ width: usageBar(provider.usedDay, provider.dailyLimit) }}
                  />
                </div>
              </div>
            </div>
          </div>

          {provider.lastError ? (
            <p
              role="alert"
              className="flex items-start gap-1.5 text-[12px] leading-4 text-[var(--projects-danger)]"
            >
              <CircleAlert size={13} strokeWidth={2} aria-hidden="true" />
              {provider.lastError}
            </p>
          ) : null}
          {provider.lastTestedAt ? (
            <p className="text-[11px] text-[var(--projects-muted)]">
              Terakhir diuji: {formatDateTime(provider.lastTestedAt)}
            </p>
          ) : null}

          <details className="text-[11px] text-[var(--projects-muted)]">
            <summary className="w-fit cursor-pointer hover:text-[var(--projects-text)]">
              Petunjuk DNS untuk provider ini
            </summary>
            <div className="mt-2 space-y-1 rounded-md border border-[var(--projects-border)] p-2.5">
              <p>
                SPF: <Mono>{`v=spf1 ${info.spf} ~all`}</Mono>
                <CopyButton text={`v=spf1 ${info.spf} ~all`} />
              </p>
              <p>
                Tambahkan record DKIM yang diberikan {info.name}, plus satu DMARC record untuk
                domain pengirim. Jangan membuat dua record SPF — gabungkan semua include dalam satu
                record.
              </p>
            </div>
          </details>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        {saved ? (
          <span className="flex items-center gap-1 text-[12px] text-emerald-400">
            <Check size={14} aria-hidden="true" /> Tersimpan
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="text-[12px] text-[var(--projects-danger)]">
            {error}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--projects-accent-border)] bg-[var(--projects-accent-strong)] px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[var(--projects-accent-hover)] disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
          Save {info.name}
        </button>
      </div>
    </AdminPanel>
  );
}

export function EmailProvidersContent() {
  const providers = useResource(getEmailProviders, []);
  const outbox = useResource(getEmailOutbox, []);
  const [testTo, setTestTo] = useState("");
  const [testProvider, setTestProvider] = useState<MailProviderId>("resend");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [testError, setTestError] = useState("");

  const refreshProviders = providers.refresh;
  const refreshOutbox = outbox.refresh;
  const refreshAll = useCallback(() => {
    void refreshProviders();
    void refreshOutbox();
  }, [refreshProviders, refreshOutbox]);

  async function sendTest() {
    setTesting(true);
    setTestResult("");
    setTestError("");
    try {
      const result = await sendTestEmail({ to: testTo, provider: testProvider });
      setTestResult(`Terkirim lewat ${result.provider} · id ${result.messageId}`);
      refreshAll();
    } catch (cause) {
      setTestError(getError(cause));
    } finally {
      setTesting(false);
    }
  }

  async function retry(id: string) {
    try {
      await retryEmail(id);
      refreshAll();
    } catch (cause) {
      setTestError(getError(cause));
    }
  }

  return (
    <div className="space-y-4">
      {providers.loading ? (
        <AdminPanel>
          <p className="flex items-center gap-2 text-[13px] text-[var(--projects-muted)]">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Memuat provider…
          </p>
        </AdminPanel>
      ) : providers.error ? (
        <AdminPanel>
          <p role="alert" className="text-[13px] text-[var(--projects-danger)]">
            {errorMessage(providers.error)}
          </p>
        </AdminPanel>
      ) : (
        (providers.data ?? []).map((provider) => (
          <ProviderCard key={provider.provider} provider={provider} onSaved={refreshAll} />
        ))
      )}

      <AdminPanel>
        <AdminPanelHeader
          title="Send test email"
          subtitle="Mengirim satu pesan uji lewat provider yang dipilih, tanpa mengubah provider aktif."
        />
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[240px] flex-1">
            <span className={labelClass}>Recipient</span>
            <input
              type="email"
              value={testTo}
              onChange={(event) => setTestTo(event.target.value)}
              className={fieldClass}
              placeholder="you@example.com"
            />
          </label>
          <label className="w-40">
            <span className={labelClass}>Provider</span>
            <select
              value={testProvider}
              onChange={(event) => setTestProvider(event.target.value as MailProviderId)}
              className={fieldClass}
            >
              <option value="resend">Resend</option>
              <option value="mailjet">Mailjet</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void sendTest()}
            disabled={testing || !testTo.trim()}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--projects-accent-border)] bg-[var(--projects-accent-strong)] px-4 text-[12.5px] font-semibold text-white transition-colors hover:bg-[var(--projects-accent-hover)] disabled:opacity-50"
          >
            {testing ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Send size={14} aria-hidden="true" />
            )}
            Send test
          </button>
        </div>
        {testResult ? <p className="mt-3 text-[12px] text-emerald-400">{testResult}</p> : null}
        {testError ? (
          <p role="alert" className="mt-3 text-[12px] text-[var(--projects-danger)]">
            {testError}
          </p>
        ) : null}
      </AdminPanel>

      <AdminPanel flush>
        <div className="px-4 pt-4">
          <AdminPanelHeader
            title="Delivery outbox"
            subtitle="Riwayat pengiriman dan pesan gagal yang bisa dicoba ulang."
          />
        </div>
        {outbox.loading ? (
          <p className="px-4 pb-4 text-[13px] text-[var(--projects-muted)]">Muat…</p>
        ) : (outbox.data ?? []).length === 0 ? (
          <p className="px-4 pb-4 text-[13px] text-[var(--projects-muted)]">
            Belum ada email yang dikirim.
          </p>
        ) : (
          <div className="admin-scrollbar overflow-x-auto">
            <table className="admin-table w-full">
              <thead>
                <tr>
                  <th className="text-left">Recipient</th>
                  <th className="text-left">Subject</th>
                  <th className="text-left">Status</th>
                  <th className="text-left">Provider</th>
                  <th className="text-left">Attempts</th>
                  <th className="text-left">Created</th>
                  <th className="text-left" />
                </tr>
              </thead>
              <tbody>
                {(outbox.data ?? []).map((row) => (
                  <tr key={row.id}>
                    <td className="text-[12px] text-[var(--projects-text)]">{row.toEmail}</td>
                    <td className="text-[12px] text-[var(--projects-text)]">{row.subject}</td>
                    <td>
                      <StatusBadge tone={statusTone(row.status)} label={row.status} />
                    </td>
                    <td className="text-[12px] text-[var(--projects-muted)]">
                      {row.provider ?? "—"}
                    </td>
                    <td className="text-[12px] text-[var(--projects-muted)]">{row.attempts}</td>
                    <td className="text-[11px] text-[var(--projects-muted)]">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td>
                      {(row.status === "failed" || row.status === "queued") && (
                        <button
                          type="button"
                          onClick={() => void retry(row.id)}
                          className="inline-flex items-center gap-1 text-[11px] text-[var(--projects-muted)] hover:text-[var(--projects-text)]"
                          aria-label={`Retry email to ${row.toEmail}`}
                        >
                          <RefreshCw size={12} aria-hidden="true" /> Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminPanel>
    </div>
  );
}

/** Standalone surface, kept for callers that want the full page framing. */
export function EmailProvidersPanel() {
  return (
    <AdminPageBody>
      <AdminHeader
        title="Email providers"
        subtitle="Kredensial Resend dan Mailjet tersimpan terenkrip. Worker memakai provider prioritas tertinggi yang masih punya kuota, lalu beralih otomatis."
      />
      <EmailProvidersContent />
    </AdminPageBody>
  );
}
