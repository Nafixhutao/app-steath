"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Settings,
  Building,
  Shield,
  Copy,
  Check,
  AlertTriangle,
  Trash2,
  LogOut,
  CreditCard,
  ArrowRight,
  Info,
  Loader2,
  Calendar,
} from "lucide-react";
import { authClient, useActiveMember, useActiveOrganization } from "@/lib/auth-client";
import { QUOTAS } from "@/lib/platform/quota-limits";
import { formatDateTime } from "@/lib/format";
import { useToast } from "@/components/toast-context";
import { copyToClipboard } from "@/lib/clipboard";
import { useGsapEntrance } from "@/lib/animation/use-gsap-entrance";

export default function SettingsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { data: organization, isPending: orgPending } = useActiveOrganization();
  const { data: activeMember, isPending: memberPending } = useActiveMember();
  const isLoading = orgPending || memberPending;

  const [name, setName] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Better Auth stores multiple roles as a comma-separated string.
  const activeRoles = activeMember?.role.split(",").map((role) => role.trim()) ?? [];
  const isOwner = activeRoles.includes("owner");
  const organizationName = organization?.name ?? "";

  const containerRef = useGsapEntrance([
    { targets: ".settings-metric-card", y: 12, duration: 0.35, stagger: 0.05 },
    { targets: ".settings-card", y: 16, duration: 0.4, stagger: 0.08, delay: 0.1 },
  ]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(organizationName).then((value) => {
      if (!cancelled) setName(value);
    });
    return () => {
      cancelled = true;
    };
  }, [organizationName]);

  async function copyText(text: string, key: string, label: string) {
    if (!(await copyToClipboard(text))) {
      toast.error("Copy failed", "Clipboard access is unavailable.");
      return;
    }
    setCopiedKey(key);
    toast.success("Copied to clipboard", `${label}: ${text}`);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 2000);
  }

  async function handleRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization || !name.trim()) return;

    setBusy(true);
    setError("");

    try {
      const result = await authClient.organization.update({
        organizationId: organization.id,
        data: { name: name.trim() },
      });

      if (result.error) {
        setError(result.error.message ?? "Could not rename this organization.");
      } else {
        toast.success("Organization renamed", `Updated to "${name.trim()}".`);
        await authClient.getSession({ query: { disableCookieCache: true } });
        router.refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "An unexpected error occurred.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization) return;

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/organizations/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation, organizationId: organization.id }),
      });
      const result = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(result.error?.message ?? "Could not delete this organization.");
      }
      toast.success("Organization deleted", "Redirecting to your organizations...");
      setBusy(false);
      router.push("/dashboard/organizations");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete this organization.");
      setBusy(false);
    }
  }

  async function handleLeaveOrganization() {
    if (!organization) return;
    if (
      !window.confirm(
        `Are you sure you want to leave ${organization.name}? You will lose access to all its projects until reinvited.`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/organizations/leave", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: organization.id }),
      });
      const result = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(result.error?.message ?? "Could not leave this organization.");
      }
      toast.success("Left organization", `You have left ${organization.name}.`);
      setBusy(false);
      router.push("/dashboard/organizations");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not leave this organization.");
      setBusy(false);
    }
  }

  return (
    <div ref={containerRef} className="pt-[28px] pb-[64px] px-[36px] max-w-[1200px] mx-auto w-full">
      {/* Header */}
      <header className="flex items-center justify-between flex-wrap gap-[16px] mb-[24px]">
        <div className="flex items-center gap-3">
          <div className="w-[40px] h-[40px] rounded-panel bg-[rgba(62,207,142,0.1)] border border-[rgba(62,207,142,0.25)] flex items-center justify-center shrink-0" aria-hidden="true">
            <Settings className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-[22px]! font-semibold! text-ink tracking-[-0.015em]! m-0">Organization Settings</h1>
              <span className="supabase-plan-badge">FREE PLAN</span>
            </div>
            <p className="text-[13px] text-[#878492] mt-[4px] leading-[1.4]">
              Manage organization details, team ownership, and preferences for{" "}
              {organization?.name ?? "your organization"}.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`settings-role-badge ${
              isOwner ? "is-owner" : activeRoles.includes("admin") ? "is-admin" : "is-member"
            }`}
          >
            <Shield className="w-3.5 h-3.5 mr-1" />
            <span className="capitalize">{activeMember?.role ?? "Member"}</span>
          </span>
        </div>
      </header>

      {/* Global Alerts */}
      {error ? (
        <div className="dashboard-alert is-error my-4" role="alert">
          {error}
        </div>
      ) : null}

      {/* Overview Metadata Cards */}
      <section
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6"
        aria-label="Organization identity"
      >
        <div className="settings-metric-card is-primary">
          <div className="flex items-center justify-between">
            <span className="settings-metric-label">Organization Name</span>
            <Building className="w-4 h-4 text-emerald-400" />
          </div>
          {isLoading ? (
            <div className="h-6 w-3/4 bg-zinc-800/80 rounded animate-pulse my-0.5" />
          ) : (
            <span className="settings-metric-val truncate" title={organization?.name}>
              {organization?.name ?? "-"}
            </span>
          )}
          <span className="text-[11px] text-zinc-400">Active workspace title</span>
        </div>

        <div className="settings-metric-card">
          <div className="flex items-center justify-between">
            <span className="settings-metric-label">Organization Slug</span>
            <button
              type="button"
              onClick={() => copyText(organization?.slug ?? "", "slug", "Slug")}
              className="text-zinc-400 hover:text-white transition-colors"
              title="Copy organization slug"
              aria-label="Copy organization slug"
            >
              {copiedKey === "slug" ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          {isLoading ? (
            <div className="h-6 w-28 bg-zinc-800/80 rounded animate-pulse my-0.5" />
          ) : (
            <span
              className="settings-metric-val font-mono text-base truncate text-emerald-400"
              title={organization?.slug}
            >
              {organization?.slug ?? "-"}
            </span>
          )}
          <span className="text-[11px] text-zinc-400">Unique routing identifier</span>
        </div>

        <div className="settings-metric-card">
          <div className="flex items-center justify-between">
            <span className="settings-metric-label">Organization ID</span>
            <button
              type="button"
              onClick={() => copyText(organization?.id ?? "", "id", "Organization ID")}
              className="text-zinc-400 hover:text-white transition-colors"
              title="Copy UUID"
              aria-label="Copy organization UUID"
            >
              {copiedKey === "id" ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          {isLoading ? (
            <div className="h-6 w-36 bg-zinc-800/80 rounded animate-pulse my-0.5" />
          ) : (
            <span
              className="settings-metric-val font-mono text-xs truncate text-zinc-300"
              title={organization?.id}
            >
              {organization?.id ?? "-"}
            </span>
          )}
          <span className="text-[11px] text-zinc-400">System UUID</span>
        </div>

        <div className="settings-metric-card">
          <div className="flex items-center justify-between">
            <span className="settings-metric-label">Created Date</span>
            <Calendar className="w-4 h-4 text-zinc-400" />
          </div>
          {isLoading ? (
            <div className="h-6 w-24 bg-zinc-800/80 rounded animate-pulse my-0.5" />
          ) : (
            <span className="settings-metric-val text-sm font-mono text-zinc-200">
              {organization?.createdAt
                ? formatDateTime(
                    organization.createdAt instanceof Date
                      ? organization.createdAt.toISOString()
                      : String(organization.createdAt),
                  )
                : "Active"}
            </span>
          )}
          <span className="text-[11px] text-zinc-400">Initial registration</span>
        </div>
      </section>

      {/* Main Settings Sections */}
      <div className="space-y-6">
        {/* SECTION 1: General Details */}
        <section className="settings-card" aria-labelledby="general-settings-heading">
          <div className="settings-card-header">
            <div className="flex items-center gap-2.5">
              <Building className="w-4 h-4 text-emerald-400" />
              <h2 id="general-settings-heading" className="text-sm font-semibold text-white">
                General Information
              </h2>
            </div>
            <span className="text-xs text-zinc-400">Display and identity</span>
          </div>

          {isOwner ? (
            <form onSubmit={handleRename}>
              <div className="settings-card-body space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="org-name-input" className="text-xs font-medium text-zinc-300">
                      Organization Name:
                    </label>
                    <span className="text-[11px] text-zinc-400 font-mono">{name.length} / 80</span>
                  </div>
                  <input
                    id="org-name-input"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                    required
                    className="settings-input"
                    placeholder="e.g. Acme Corp"
                  />
                  <p className="text-[11px] text-zinc-400 mt-1.5">
                    This is your team&apos;s public workspace display name shown in the top
                    navigation bar.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-medium text-zinc-400 block mb-1.5">
                    Workspace Slug (Read-only):
                  </label>
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-950/40 border border-zinc-800">
                    <code className="text-xs font-mono text-zinc-300">{organization?.slug}</code>
                    <button
                      type="button"
                      onClick={() => copyText(organization?.slug ?? "", "slug-inner", "Slug")}
                      className="text-zinc-400 hover:text-white transition-colors"
                      title="Copy slug"
                      aria-label="Copy workspace slug"
                    >
                      {copiedKey === "slug-inner" ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-card-footer">
                <span className="text-xs text-zinc-400">
                  Name changes take effect immediately across all dashboard projects.
                </span>
                <button
                  type="submit"
                  className="supabase-btn-green"
                  disabled={busy || !name.trim() || name.trim() === organization?.name}
                >
                  {busy ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5 mr-1" />
                      Save Changes
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            <div className="settings-card-body">
              <div className="flex items-start gap-[12px] py-[12px] px-[16px] rounded-card bg-[rgba(6,182,212,0.08)] border border-[rgba(6,182,212,0.25)]">
                <Info className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-cyan-200 leading-relaxed">
                  You are viewing this organization as a{" "}
                  <strong>{activeMember?.role ?? "member"}</strong>. Only organization owners have
                  permission to edit organization details or manage billing.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* SECTION 2: Plan & Entitlements */}
        <section className="settings-card" aria-labelledby="plan-settings-heading">
          <div className="settings-card-header">
            <div className="flex items-center gap-2.5">
              <CreditCard className="w-4 h-4 text-cyan-400" />
              <h2 id="plan-settings-heading" className="text-sm font-semibold text-white">
                Subscription &amp; Entitlements
              </h2>
            </div>
            <span className="supabase-plan-badge">FREE TIER</span>
          </div>

          <div className="settings-card-body">
            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              Your organization is currently on the <strong>Free Plan</strong>, suitable for
              self-hosted development environments, internal tools, and container workloads.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="settings-feature-pill">
                <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span>Up to {QUOTAS.projectsPerOrganization} Projects</span>
              </div>
              <div className="settings-feature-pill">
                <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span>
                  Up to {QUOTAS.servicesPerOrganization} Docker Services (
                  {QUOTAS.servicesPerProject} per Project)
                </span>
              </div>
              <div className="settings-feature-pill">
                <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span>Managed databases</span>
              </div>
              <div className="settings-feature-pill">
                <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span>Automated Daily Backups</span>
              </div>
              <div className="settings-feature-pill">
                <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span>Custom Domain TLS Routing</span>
              </div>
              <div className="settings-feature-pill">
                <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span>Caddy Zero-Downtime Edge</span>
              </div>
            </div>
          </div>

          <div className="settings-card-footer">
            <span className="text-xs text-zinc-400">
              Need higher limits or dedicated node clusters?
            </span>
            <Link
              href="/dashboard/usage"
              className="supabase-btn-secondary text-xs inline-flex items-center gap-1.5"
            >
              <span>View Usage Meters</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </section>

        {/* SECTION 3: Danger Zone */}
        {isOwner ? (
          <section className="settings-card is-danger" aria-labelledby="danger-heading">
            <div className="settings-card-header border-rose-900/30">
              <div className="flex items-center gap-2.5 text-rose-400">
                <AlertTriangle className="w-4 h-4" />
                <h2 id="danger-heading" className="text-sm font-semibold text-rose-400">
                  Danger Zone
                </h2>
              </div>
              <span className="text-xs text-rose-400/80">Irreversible actions</span>
            </div>

            <div className="settings-card-body space-y-4">
              <div className="p-3.5 rounded-lg bg-rose-950/25 border border-rose-900/50 text-rose-200 text-xs leading-relaxed">
                <strong>Permanent Deletion Warning:</strong> Deleting{" "}
                <strong>{organization?.name}</strong> will immediately terminate all running
                containers, erase attached persistent volumes, remove managed databases, invalidate
                custom domain certificates, and revoke all member access. This operation cannot be
                recovered.
              </div>

              <form onSubmit={handleDeleteOrganization} className="space-y-3">
                <div>
                  <label
                    htmlFor="confirm-delete-input"
                    className="text-xs font-medium text-zinc-300 block mb-1.5"
                  >
                    Type <strong>{organization?.name}</strong> to confirm deletion:
                  </label>
                  <input
                    id="confirm-delete-input"
                    type="text"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    placeholder={organization?.name}
                    autoComplete="off"
                    spellCheck="false"
                    required
                    className="settings-input border-rose-900/50 focus:border-rose-500"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    className="project-btn-danger"
                    disabled={busy || confirmation.trim() !== organization?.name}
                  >
                    {busy ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4 mr-1.5" />
                        Delete Organization Permanently
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : (
          <section className="settings-card is-danger" aria-labelledby="leave-heading">
            <div className="settings-card-header border-rose-900/30">
              <div className="flex items-center gap-2.5 text-rose-400">
                <LogOut className="w-4 h-4" />
                <h2 id="leave-heading" className="text-sm font-semibold text-rose-400">
                  Leave Organization
                </h2>
              </div>
              <span className="text-xs text-rose-400/80">Revoke membership</span>
            </div>

            <div className="settings-card-body">
              <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                Revoke your membership from <strong>{organization?.name}</strong>. You will
                immediately lose access to all projects, services, and databases until an owner
                re-invites you.
              </p>

              <button
                type="button"
                className="project-btn-danger"
                onClick={() => void handleLeaveOrganization()}
                disabled={busy}
              >
                {busy ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Leaving...
                  </>
                ) : (
                  <>
                    <LogOut className="w-4 h-4 mr-1.5" />
                    Leave Organization
                  </>
                )}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
