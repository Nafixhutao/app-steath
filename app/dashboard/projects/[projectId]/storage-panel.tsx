"use client";

import { useCallback, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  Globe,
  HardDrive,
  Loader2,
  Lock,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  createProjectStorageBucket,
  deleteProjectStorageBucket,
  getProjectStorage,
  revealProjectStorageBucketSecret,
  type StorageBucketStatus,
  type StorageBucketSummary,
} from "@/lib/storage-client";
import { QUOTAS } from "@/lib/platform/quota-limits";
import { getError, useResource } from "@/lib/resource";
import { formatDateTime } from "@/lib/format";
import { useToast } from "@/components/toast-context";
import { ModalDialog } from "@/components/supabase-modal";

const STATUS_LABELS: Record<StorageBucketStatus, string> = {
  provisioning: "Provisioning",
  ready: "Ready",
  failed: "Failed",
};

/** S3 bucket names: 3–63 characters, lowercase alphanumeric and dashes only. */
const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

const MAX_QUOTA_MB = QUOTAS.bucketStorageMb;
const QUOTA_CHOICES = [256, 512, QUOTAS.bucketStorageMb].filter(
  (value, index, values) => value <= QUOTAS.bucketStorageMb && values.indexOf(value) === index,
);

/** The API reports a bare hostname; the browser always talks to it over TLS. */
function endpointBase(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Path-style addressing: the bucket is the first path segment after the host. */
function bucketUrl(bucket: StorageBucketSummary): string {
  return `${endpointBase(bucket.endpoint)}/${bucket.objectName}`;
}

function usageLabel(bucket: StorageBucketSummary): string {
  return bucket.usageMb === null ? "—" : `${bucket.usageMb} MB of ${bucket.quotaMb} MB`;
}

/** A label/value pair with its own copy button, as in the Database credentials card. */
function CopyValue({ label, value }: { label: string; value: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  function copy() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success(`${label} copied`);
    });
  }

  return (
    <div className="db-cred-row [&:not(:first-child)]:border-t [&:not(:first-child)]:border-[#232129] [@media(max-width:400px)]:py-[10px] [@media(max-width:400px)]:px-[12px] flex flex-col gap-[4px] py-[12px] px-[14px] min-w-0">
      <span className="flex items-center gap-[8px] text-[10.5px] uppercase tracking-[0.04em] text-[#636170]">
        {label}
        {copied ? (
          <span className="db-cred-copied normal-case text-[10px] font-semibold tracking-[0.02em] text-accent" role="status">
            Tersalin
          </span>
        ) : null}
      </span>
      <div className="flex items-start gap-[10px] min-w-0">
        <span className="db-cred-value flex-auto [word-break:break-all] [font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-ink min-w-0 text-[14px] leading-[1.5] [overflow-wrap:anywhere] is-mono">{value}</span>
        <button
          type="button"
          className="bg-[#1f1e26] [&:hover:not(:disabled)]:bg-[#272532] focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] flex-none inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-0 rounded-control border border-[#2e2c39] text-[#8e8c99] cursor-pointer [transition:background-color_120ms,color_120ms,border-color_120ms] [&:hover:not(:disabled)]:border-[#3a3846] [&:hover:not(:disabled)]:text-ink disabled:opacity-[0.55] disabled:cursor-not-allowed"
          onClick={copy}
          aria-label={`Copy ${label.toLowerCase()}`}
          title={`Copy ${label.toLowerCase()}`}
        >
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

/**
 * The secret key is fetched only after an explicit Reveal click, so it is never
 * part of the page payload. Hiding it also drops the value from component state.
 */
function SecretKeyRow({ projectId, bucketId }: { projectId: string; bucketId: string }) {
  const { toast } = useToast();
  const [secret, setSecret] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load(): Promise<string | null> {
    if (secret) return secret;
    setLoading(true);
    try {
      const result = await revealProjectStorageBucketSecret(projectId, bucketId);
      setSecret(result.secretKey);
      return result.secretKey;
    } catch (cause) {
      toast.error("Could not reveal the secret key", getError(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    if (visible) {
      setVisible(false);
      setSecret(null);
      setCopied(false);
      return;
    }
    const value = await load();
    if (value !== null) setVisible(true);
  }

  async function copySecret() {
    const value = await load();
    if (value === null || typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("Secret key copied", "Store it somewhere safe.");
    });
  }

  return (
    <div className="db-cred-row [&:not(:first-child)]:border-t [&:not(:first-child)]:border-[#232129] [@media(max-width:400px)]:py-[10px] [@media(max-width:400px)]:px-[12px] flex flex-col gap-[4px] py-[12px] px-[14px] min-w-0">
      <span className="flex items-center gap-[8px] text-[10.5px] uppercase tracking-[0.04em] text-[#636170]">
        Secret key
        {copied ? (
          <span className="db-cred-copied normal-case text-[10px] font-semibold tracking-[0.02em] text-accent" role="status">
            Tersalin
          </span>
        ) : null}
      </span>
      <div className="flex items-start gap-[10px] min-w-0">
        <span className="db-cred-value flex-auto [word-break:break-all] [font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-ink min-w-0 text-[14px] leading-[1.5] [overflow-wrap:anywhere] is-mono min-h-[21px]" aria-live="polite">
          {loading ? (
            <span className="text-[#716f7c] [font-family:inherit]">
              <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Loading…
            </span>
          ) : visible && secret ? (
            secret
          ) : secret ? (
            "••••••••••••••••"
          ) : (
            <span className="text-[#716f7c] [font-family:inherit]">Hidden</span>
          )}
        </span>
      </div>
      <div className="db-cred-password-actions [@media(max-width:400px)]:w-full flex flex-wrap gap-[8px] mt-[8px]">
        <button
          type="button"
          className="db-cred-action [@media(max-width:400px)]:flex-auto focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] bg-[#1f1e26] text-[12.5px] font-medium [&:hover:not(:disabled)]:bg-[#272532] disabled:opacity-[0.55] disabled:cursor-not-allowed inline-flex items-center justify-center gap-[6px] min-h-[44px] py-[8px] px-[14px] rounded-control border border-[#2e2c39] text-[#d4d4d8] cursor-pointer [transition:background-color_120ms,color_120ms,border-color_120ms] [&:hover:not(:disabled)]:border-[#3a3846] [&:hover:not(:disabled)]:text-ink"
          onClick={() => void toggle()}
          disabled={loading}
          aria-label={visible ? "Hide secret key" : "Reveal secret key"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {visible ? "Hide" : "Reveal"}
        </button>
        <button
          type="button"
          className="db-cred-action [@media(max-width:400px)]:flex-auto focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] bg-[#1f1e26] text-[12.5px] font-medium [&:hover:not(:disabled)]:bg-[#272532] disabled:opacity-[0.55] disabled:cursor-not-allowed inline-flex items-center justify-center gap-[6px] min-h-[44px] py-[8px] px-[14px] rounded-control border border-[#2e2c39] text-[#d4d4d8] cursor-pointer [transition:background-color_120ms,color_120ms,border-color_120ms] [&:hover:not(:disabled)]:border-[#3a3846] [&:hover:not(:disabled)]:text-ink"
          onClick={() => void copySecret()}
          disabled={loading}
          aria-label="Copy secret key"
        >
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          {copied ? "Tersalin" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function BucketCard({
  bucket,
  canManage,
  busy,
  onDelete,
}: {
  bucket: StorageBucketSummary;
  canManage: boolean;
  busy: boolean;
  onDelete: (bucket: StorageBucketSummary) => void;
}) {
  const ready = bucket.status === "ready" && bucket.healthy;
  const url = bucketUrl(bucket);
  const publicUrl = `${url}/your-object-key`;
  const sdkExample = `import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: "${endpointBase(bucket.endpoint)}",
  region: "auto",
  forcePathStyle: true, // path-style: /<bucket>/<key>
  credentials: {
    accessKeyId: "${bucket.accessKey}",
    secretAccessKey: "YOUR_SECRET_KEY", // reveal it above
  },
});

await s3.send(new PutObjectCommand({
  Bucket: "${bucket.objectName}",
  Key: "hello.txt",
  Body: "Hello from S3",
}));
${bucket.public ? `// Public buckets allow anonymous reads:\n// ${publicUrl}\n` : ""}`;

  return (
    <div className="flex flex-col py-[16px] px-[20px] rounded-card bg-surface border border-surface-raised [transition:border-color_150ms] hover:border-[#34323e]">
      <div className="flex items-center justify-between flex-wrap gap-[12px]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="bg-[#211f29] flex items-center justify-center w-[32px] h-[32px] rounded-control shrink-0" aria-hidden="true">
            <HardDrive className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-ink hover:text-accent text-[14.5px] font-semibold! no-underline [transition:color_150ms]">{bucket.name}</h3>
            <span className="text-[#716f7c] hover:text-ink-console inline-flex items-center gap-[4px] text-[12px] [font-family:monospace] no-underline mt-[2px]">{bucket.objectName}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className={`project-proxy-badge inline-flex items-center text-[11px] font-semibold py-[3px] px-[8px] rounded-control-sm ${bucket.public ? "is-enabled" : "is-disabled"}`}>
            {bucket.public ? <Globe className="w-3 h-3 mr-1" /> : <Lock className="w-3 h-3 mr-1" />}
            {bucket.public ? "Public" : "Private"}
          </span>
          <span className={`project-service-status-pill inline-flex items-center gap-[6px] text-[11px] font-medium py-[2px] px-[8px] rounded-control-sm border border-[#2a2835] bg-[#1c1a22] text-[#8e8c99] ${ready ? "is-live" : "is-building"}`}>
            <span className="project-status-dot bg-current w-[6px] h-[6px] rounded-[50%]" aria-hidden="true" />
            {STATUS_LABELS[bucket.status]}
          </span>
          {bucket.healthy ? null : (
            <span className="project-health-badge text-[11px] font-semibold py-[2px] px-[7px] rounded-control-sm is-unhealthy">Unavailable</span>
          )}
          {canManage ? (
            <button
              type="button"
              className="project-service-delete-btn inline-flex items-center justify-center w-[28px] h-[28px] rounded-control bg-transparent border border-transparent text-[#716f7c] cursor-pointer [transition:all_120ms] hover:border-[rgba(244,63,94,0.2)] hover:text-[var(--color-danger)]"
              onClick={() => onDelete(bucket)}
              disabled={busy}
              title={`Delete ${bucket.name}`}
              aria-label={`Delete ${bucket.name}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex items-center flex-wrap gap-[16px] mt-[14px] pt-[12px] border-t border-t-[#211f27] text-[12px] text-[#8e8c99]">
        <div className="flex flex-col min-w-[150px]">
          <span className="text-[11.5px] text-[#716f7c] mb-[3px]">Storage used</span>
          <span className="text-[13px] font-semibold text-ink">{usageLabel(bucket)}</span>
          <div className="bg-[#211f2a] w-full h-[4px] rounded-[99px] overflow-hidden mt-1.5">
            <div
              className="bg-accent h-full rounded-[99px] [transition:width_300ms_ease]"
              style={{
                width: `${
                  bucket.quotaMb > 0
                    ? Math.min(100, Math.round(((bucket.usageMb ?? 0) / bucket.quotaMb) * 100))
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
        <div className="flex flex-col min-w-[150px]">
          <span className="text-[11.5px] text-[#716f7c] mb-[3px]">Created At</span>
          <span className="text-[13px] font-semibold text-ink text-xs text-zinc-300">
            {formatDateTime(bucket.createdAt)}
          </span>
        </div>
      </div>

      <div className="bg-[#141318] flex flex-col rounded-card border border-[#232129] overflow-hidden mt-4">
        <CopyValue label="Endpoint URL" value={url} />
        <CopyValue label="Access key" value={bucket.accessKey} />
        {canManage ? (
          <SecretKeyRow projectId={bucket.projectId} bucketId={bucket.id} />
        ) : (
          <div className="db-cred-row [&:not(:first-child)]:border-t [&:not(:first-child)]:border-[#232129] [@media(max-width:400px)]:py-[10px] [@media(max-width:400px)]:px-[12px] flex flex-col gap-[4px] py-[12px] px-[14px] min-w-0">
            <span className="flex items-center gap-[8px] text-[10.5px] uppercase tracking-[0.04em] text-[#636170]">Secret key</span>
            <div className="flex items-start gap-[10px] min-w-0">
              <span className="db-cred-value flex-auto [word-break:break-all] [font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-ink min-w-0 text-[14px] leading-[1.5] [overflow-wrap:anywhere] text-[#716f7c] [font-family:inherit]">Owner or admin only</span>
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] text-zinc-500 mt-2">
        Secret keys are stored encrypted at rest and can be revealed at any time by an owner or
        admin.
      </p>

      <details className="mt-3">
        <summary className="text-xs text-zinc-400 hover:text-white w-fit">
          Show AWS SDK (JavaScript) example
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-md border border-zinc-800 bg-[#141318] p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
          {sdkExample}
        </pre>
      </details>
    </div>
  );
}

const EMPTY_FORM = {
  name: "",
  public: false,
  quotaMb: String(MAX_QUOTA_MB),
};

export function StoragePanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StorageBucketSummary | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [actionError, setActionError] = useState("");

  const panel = useResource(
    useCallback(async () => getProjectStorage(projectId), [projectId]),
    [projectId],
  );
  const buckets = panel.data?.buckets ?? [];
  const endpoint = panel.data?.endpoint ?? "";
  const atLimit = buckets.length >= QUOTAS.bucketsPerProject;
  const nameValid = BUCKET_NAME_PATTERN.test(form.name.trim());
  const duplicateName = buckets.some((bucket) => bucket.name === form.name.trim());

  function update<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nameValid || duplicateName) return;

    setBusy(true);
    setActionError("");
    try {
      const created = await createProjectStorageBucket(projectId, {
        name: form.name.trim(),
        public: form.public,
        quotaMb: Number(form.quotaMb),
      });
      setForm(EMPTY_FORM);
      setModalOpen(false);
      toast.success("Bucket created", `"${created.name}" is being provisioned.`);
      await panel.refresh();
    } catch (cause) {
      const message = getError(cause);
      setActionError(message);
      toast.error("Could not create bucket", message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteTarget) return;

    setBusy(true);
    setActionError("");
    try {
      await deleteProjectStorageBucket(projectId, deleteTarget.id, deleteConfirm);
      toast.success("Bucket deleted", `"${deleteTarget.name}" and all its objects are gone.`);
      setDeleteTarget(null);
      setDeleteConfirm("");
      await panel.refresh();
    } catch (cause) {
      const message = getError(cause);
      setActionError(message);
      toast.error("Could not delete bucket", message);
    } finally {
      setBusy(false);
    }
  }

  if (panel.loading) {
    return (
      <div className="space-y-4">
        <div className="bg-surface flex flex-col justify-between p-[16px] rounded-card border border-surface-raised min-h-[120px] h-44" aria-hidden="true">
          <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-5 w-48 rounded mb-4" />
          <div className="grid grid-cols-1 gap-4">
            <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-12 rounded" />
            <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-12 rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Object Storage</h2>
          <p className="text-xs text-zinc-400">
            {buckets.length} of {QUOTAS.bucketsPerProject} Buckets in this project
            {endpoint ? ` · S3 endpoint ${endpoint}` : ""}
          </p>
        </div>

        {canManage ? (
          <button
            type="button"
            className="supabase-btn-green"
            onClick={() => {
              setActionError("");
              setForm(EMPTY_FORM);
              setModalOpen(true);
            }}
            disabled={atLimit || busy}
            title={atLimit ? `Limit of ${QUOTAS.bucketsPerProject} buckets reached` : undefined}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>New Bucket</span>
          </button>
        ) : null}
      </div>

      {!modalOpen && !deleteTarget && (panel.error || actionError) ? (
        <div className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error" role="alert">
          {panel.error || actionError}
        </div>
      ) : null}

      {buckets.length === 0 ? (
        <div className="bg-surface flex flex-col items-center justify-center py-[56px] px-[24px] rounded-card border border-dashed border-[#262430] text-center">
          <div className="bg-[#211f29] flex items-center justify-center w-[48px] h-[48px] rounded-card-lg" aria-hidden="true">
            <HardDrive className="w-8 h-8 text-zinc-500" />
          </div>
          <h3 className="text-base font-semibold text-white mt-3">No buckets yet</h3>
          <p className="text-xs text-zinc-400 max-w-md mt-1 mb-4 text-center">
            Create an S3-compatible bucket for uploads, backups, or static assets. Services in this
            project reach it over the private storage network.
          </p>
          {canManage ? (
            <button
              type="button"
              className="supabase-btn-green"
              onClick={() => {
                setActionError("");
                setModalOpen(true);
              }}
              disabled={atLimit}
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Create First Bucket</span>
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {buckets.map((bucket) => (
            <BucketCard
              key={bucket.id}
              bucket={bucket}
              canManage={canManage}
              busy={busy}
              onDelete={(target) => {
                setActionError("");
                setDeleteTarget(target);
                setDeleteConfirm("");
              }}
            />
          ))}
        </div>
      )}

      {/* Modal: Create Bucket */}
      {modalOpen ? (
        <ModalDialog labelledBy="create-bucket-title" onClose={() => setModalOpen(false)}>
          <div className="supabase-modal-header flex items-center justify-between py-[18px] px-[20px]">
            <h2 id="create-bucket-title">Create a new bucket</h2>
            <button
              type="button"
              className="supabase-modal-close flex items-center justify-center w-[28px] h-[28px] rounded-control bg-transparent border-0 text-[#716f7c] cursor-pointer [transition:color_150ms,background-color_150ms] hover:text-ink-console"
              onClick={() => setModalOpen(false)}
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={submit}>
            <div className="supabase-modal-body space-y-3.5">
              <p className="text-sm text-zinc-400">
                An S3-compatible bucket on the platform storage node, with its own access key and
                optional anonymous read access.
              </p>

              <div>
                <label htmlFor="bucket-name-input" className="block text-[13px] font-medium text-[#c9c7d2] mb-[6px]">
                  Bucket Name
                </label>
                <input
                  id="bucket-name-input"
                  value={form.name}
                  minLength={3}
                  maxLength={63}
                  pattern="[a-z0-9][a-z0-9-]{1,61}[a-z0-9]"
                  required
                  placeholder="e.g. user-uploads"
                  onChange={(event) => update("name", event.target.value)}
                  className="supabase-modal-input w-full h-[38px] py-0 px-[12px] rounded-control bg-[#1a1920] text-ink outline-none [transition:border-color_150ms] font-mono text-xs"
                  autoFocus
                />
                <p className="mt-1.5 text-xs text-zinc-500">
                  3–63 lowercase letters, numbers, or dashes; it cannot start or end with a dash.
                </p>
              </div>

              <div>
                <label htmlFor="bucket-quota-input" className="block text-[13px] font-medium text-[#c9c7d2] mb-[6px]">
                  Storage quota
                </label>
                <select
                  id="bucket-quota-input"
                  value={form.quotaMb}
                  onChange={(event) => update("quotaMb", event.target.value)}
                  className="supabase-modal-input w-full h-[38px] py-0 px-[12px] rounded-control bg-[#1a1920] text-ink outline-none [transition:border-color_150ms]"
                >
                  {QUOTA_CHOICES.map((quota) => (
                    <option key={quota} value={quota}>
                      {quota} MB
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-zinc-500">
                  Maximum {MAX_QUOTA_MB} MB per bucket on this plan.
                </p>
              </div>

              <label className="flex items-start gap-2.5 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={form.public}
                  onChange={(event) => update("public", event.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-emerald-500"
                />
                <span>
                  <strong className="font-medium text-white">Public bucket</strong>
                  <span className="block text-zinc-500">
                    Allow anonymous read access to objects.
                  </span>
                </span>
              </label>

              {actionError ? (
                <p className="text-[11.5px] text-[#ff7a82] mt-[6px]" role="alert">
                  <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
                  {actionError}
                </p>
              ) : null}
            </div>

            <div className="supabase-modal-footer">
              <button
                type="button"
                className="supabase-btn-secondary font-medium focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] inline-flex items-center justify-center min-h-[38px] rounded-card border border-[#2a2834] bg-[#181720] [box-shadow:0_1px_2px_rgba(0,0,0,0.2)] whitespace-nowrap no-underline [transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease,color_120ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:border-[#3b3749] [&:hover:not(:disabled)]:bg-[#201e2a] [&:active:not(:disabled)]:translate-y-[1px] disabled:opacity-[0.5] disabled:transform-none"
                onClick={() => setModalOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="supabase-btn-green"
                disabled={busy || !nameValid || duplicateName}
              >
                {busy ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Creating…
                  </>
                ) : (
                  "Create bucket"
                )}
              </button>
            </div>
          </form>
        </ModalDialog>
      ) : null}

      {/* Modal: Delete Bucket Confirmation */}
      {deleteTarget ? (
        <ModalDialog labelledBy="delete-bucket-title" onClose={() => setDeleteTarget(null)}>
          <div className="supabase-modal-header flex items-center justify-between py-[18px] px-[20px] border-rose-900/40">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertTriangle className="w-4 h-4" />
              <h2 id="delete-bucket-title">Delete bucket</h2>
            </div>
            <button
              type="button"
              className="supabase-modal-close flex items-center justify-center w-[28px] h-[28px] rounded-control bg-transparent border-0 text-[#716f7c] cursor-pointer [transition:color_150ms,background-color_150ms] hover:text-ink-console"
              onClick={() => setDeleteTarget(null)}
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleDelete}>
            <div className="supabase-modal-body space-y-3">
              <p className="text-xs text-zinc-300">
                This permanently deletes <strong className="text-white">{deleteTarget.name}</strong>{" "}
                and every object stored in it. This action cannot be undone.
              </p>
              <div>
                <label htmlFor="delete-bucket-confirm-input" className="block text-[13px] font-medium text-[#c9c7d2] mb-[6px]">
                  Type <strong>{deleteTarget.name}</strong> to confirm:
                </label>
                <input
                  id="delete-bucket-confirm-input"
                  value={deleteConfirm}
                  onChange={(event) => setDeleteConfirm(event.target.value)}
                  placeholder={deleteTarget.name}
                  autoComplete="off"
                  className="supabase-modal-input w-full h-[38px] py-0 px-[12px] rounded-control bg-[#1a1920] text-ink outline-none [transition:border-color_150ms] border-rose-900/50 focus:border-rose-500"
                  autoFocus
                />
              </div>

              {actionError ? (
                <p className="text-[11.5px] text-[#ff7a82] mt-[6px]" role="alert">
                  <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
                  {actionError}
                </p>
              ) : null}
            </div>

            <div className="supabase-modal-footer">
              <button
                type="button"
                className="supabase-btn-secondary font-medium focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] inline-flex items-center justify-center min-h-[38px] rounded-card border border-[#2a2834] bg-[#181720] [box-shadow:0_1px_2px_rgba(0,0,0,0.2)] whitespace-nowrap no-underline [transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease,color_120ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:border-[#3b3749] [&:hover:not(:disabled)]:bg-[#201e2a] [&:active:not(:disabled)]:translate-y-[1px] disabled:opacity-[0.5] disabled:transform-none"
                onClick={() => setDeleteTarget(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--color-danger)] focus-visible:outline-offset-[2px] disabled:opacity-[0.5] disabled:cursor-not-allowed inline-flex items-center justify-center gap-[8px] min-h-[38px] py-[8px] px-[16px] rounded-card border-0 bg-[#e11d48] [background-image:linear-gradient(180deg,var(--color-danger)_0%,#e11d48_100%)] [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.25),0_1px_3px_rgba(0,0,0,0.3),0_0_0_1px_#be123c] text-ink text-[13.5px]! font-medium! whitespace-nowrap [transition:background-color_150ms_ease,box-shadow_150ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:[background-image:linear-gradient(180deg,#fb7185_0%,var(--color-danger)_100%)] [&:hover:not(:disabled)]:text-ink [&:active:not(:disabled)]:translate-y-[1] disabled:transform-none disabled:[box-shadow:none]"
                disabled={busy || deleteConfirm !== deleteTarget.name}
              >
                {busy ? "Deleting…" : "Delete bucket"}
              </button>
            </div>
          </form>
        </ModalDialog>
      ) : null}
    </div>
  );
}
