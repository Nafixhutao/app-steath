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
    <div className="db-cred-row">
      <span className="db-cred-label">
        {label}
        {copied ? (
          <span className="db-cred-copied" role="status">
            Tersalin
          </span>
        ) : null}
      </span>
      <div className="db-cred-value-wrap">
        <span className="db-cred-value is-mono">{value}</span>
        <button
          type="button"
          className="db-cred-copy"
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
    <div className="db-cred-row">
      <span className="db-cred-label">
        Secret key
        {copied ? (
          <span className="db-cred-copied" role="status">
            Tersalin
          </span>
        ) : null}
      </span>
      <div className="db-cred-value-wrap">
        <span className="db-cred-value is-mono db-cred-password-value" aria-live="polite">
          {loading ? (
            <span className="db-cred-muted">
              <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Loading…
            </span>
          ) : visible && secret ? (
            secret
          ) : secret ? (
            "••••••••••••••••"
          ) : (
            <span className="db-cred-muted">Hidden</span>
          )}
        </span>
      </div>
      <div className="db-cred-password-actions">
        <button
          type="button"
          className="db-cred-action"
          onClick={() => void toggle()}
          disabled={loading}
          aria-label={visible ? "Hide secret key" : "Reveal secret key"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {visible ? "Hide" : "Reveal"}
        </button>
        <button
          type="button"
          className="db-cred-action"
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
    <div className="project-service-item">
      <div className="project-service-head">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="project-service-icon" aria-hidden="true">
            <HardDrive className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <h3 className="project-service-name">{bucket.name}</h3>
            <span className="project-service-hostname">{bucket.objectName}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className={`project-proxy-badge ${bucket.public ? "is-enabled" : "is-disabled"}`}>
            {bucket.public ? <Globe className="w-3 h-3 mr-1" /> : <Lock className="w-3 h-3 mr-1" />}
            {bucket.public ? "Public" : "Private"}
          </span>
          <span className={`project-service-status-pill ${ready ? "is-live" : "is-building"}`}>
            <span className="project-status-dot" aria-hidden="true" />
            {STATUS_LABELS[bucket.status]}
          </span>
          {bucket.healthy ? null : (
            <span className="project-health-badge is-unhealthy">Unavailable</span>
          )}
          {canManage ? (
            <button
              type="button"
              className="project-service-delete-btn"
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

      <div className="project-service-footer">
        <div className="project-db-metric-box min-w-[150px]">
          <span className="project-db-metric-label">Storage used</span>
          <span className="project-db-metric-value">{usageLabel(bucket)}</span>
          <div className="supabase-usage-bar-track mt-1.5">
            <div
              className="supabase-usage-bar-fill"
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
        <div className="project-db-metric-box min-w-[150px]">
          <span className="project-db-metric-label">Created At</span>
          <span className="project-db-metric-value text-xs text-zinc-300">
            {formatDateTime(bucket.createdAt)}
          </span>
        </div>
      </div>

      <div className="db-cred-card mt-4">
        <CopyValue label="Endpoint URL" value={url} />
        <CopyValue label="Access key" value={bucket.accessKey} />
        {canManage ? (
          <SecretKeyRow projectId={bucket.projectId} bucketId={bucket.id} />
        ) : (
          <div className="db-cred-row">
            <span className="db-cred-label">Secret key</span>
            <div className="db-cred-value-wrap">
              <span className="db-cred-value db-cred-muted">Owner or admin only</span>
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
        <div className="supabase-project-skeleton-card h-44" aria-hidden="true">
          <div className="supabase-skeleton-box h-5 w-48 rounded mb-4" />
          <div className="grid grid-cols-1 gap-4">
            <div className="supabase-skeleton-box h-12 rounded" />
            <div className="supabase-skeleton-box h-12 rounded" />
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
        <div className="dashboard-alert is-error" role="alert">
          {panel.error || actionError}
        </div>
      ) : null}

      {buckets.length === 0 ? (
        <div className="project-empty-card">
          <div className="project-empty-icon-wrap" aria-hidden="true">
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
        <div className="supabase-modal-backdrop" role="presentation">
          <div
            className="supabase-modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-bucket-title"
          >
            <div className="supabase-modal-header">
              <h2 id="create-bucket-title">Create a new bucket</h2>
              <button
                type="button"
                className="supabase-modal-close"
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
                  <label htmlFor="bucket-name-input" className="supabase-modal-label">
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
                    className="supabase-modal-input font-mono text-xs"
                    autoFocus
                  />
                  <p className="mt-1.5 text-xs text-zinc-500">
                    3–63 lowercase letters, numbers, or dashes; it cannot start or end with a dash.
                  </p>
                </div>

                <div>
                  <label htmlFor="bucket-quota-input" className="supabase-modal-label">
                    Storage quota
                  </label>
                  <select
                    id="bucket-quota-input"
                    value={form.quotaMb}
                    onChange={(event) => update("quotaMb", event.target.value)}
                    className="supabase-modal-input"
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
                  <p className="db-cred-error" role="alert">
                    <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
                    {actionError}
                  </p>
                ) : null}
              </div>

              <div className="supabase-modal-footer">
                <button
                  type="button"
                  className="supabase-btn-secondary"
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
          </div>
        </div>
      ) : null}

      {/* Modal: Delete Bucket Confirmation */}
      {deleteTarget ? (
        <div className="supabase-modal-backdrop" role="presentation">
          <div
            className="supabase-modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-bucket-title"
          >
            <div className="supabase-modal-header border-rose-900/40">
              <div className="flex items-center gap-2 text-rose-400">
                <AlertTriangle className="w-4 h-4" />
                <h2 id="delete-bucket-title">Delete bucket</h2>
              </div>
              <button
                type="button"
                className="supabase-modal-close"
                onClick={() => setDeleteTarget(null)}
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleDelete}>
              <div className="supabase-modal-body space-y-3">
                <p className="text-xs text-zinc-300">
                  This permanently deletes{" "}
                  <strong className="text-white">{deleteTarget.name}</strong> and every object
                  stored in it. This action cannot be undone.
                </p>
                <div>
                  <label htmlFor="delete-bucket-confirm-input" className="supabase-modal-label">
                    Type <strong>{deleteTarget.name}</strong> to confirm:
                  </label>
                  <input
                    id="delete-bucket-confirm-input"
                    value={deleteConfirm}
                    onChange={(event) => setDeleteConfirm(event.target.value)}
                    placeholder={deleteTarget.name}
                    autoComplete="off"
                    className="supabase-modal-input border-rose-900/50 focus:border-rose-500"
                    autoFocus
                  />
                </div>

                {actionError ? (
                  <p className="db-cred-error" role="alert">
                    <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
                    {actionError}
                  </p>
                ) : null}
              </div>

              <div className="supabase-modal-footer">
                <button
                  type="button"
                  className="supabase-btn-secondary"
                  onClick={() => setDeleteTarget(null)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="project-btn-danger"
                  disabled={busy || deleteConfirm !== deleteTarget.name}
                >
                  {busy ? "Deleting…" : "Delete bucket"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
