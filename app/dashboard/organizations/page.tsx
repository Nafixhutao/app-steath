"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X, Loader2 } from "lucide-react";
import { authClient, useListOrganizations } from "@/lib/auth-client";
import { useToast } from "@/components/toast-context";
import { useGsapEntrance } from "@/lib/animation/use-gsap-entrance";
import { ModalDialog } from "@/components/supabase-modal";

function OrgHexIcon() {
  return (
    <div className="flex items-center justify-center w-[36px] h-[36px] rounded-card bg-[#211f27] text-[#8e8c99] shrink-0" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor">
        <circle cx="12" cy="7" r="2.5" fill="currentColor" />
        <circle cx="7" cy="15" r="2.5" fill="currentColor" />
        <circle cx="17" cy="15" r="2.5" fill="currentColor" />
      </svg>
    </div>
  );
}

export default function OrganizationsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { data: organizations, isPending } = useListOrganizations();

  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [busy, setBusy] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const orgList = useMemo(() => organizations ?? [], [organizations]);

  const filteredOrgs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orgList;
    return orgList.filter((org) => org.name.toLowerCase().includes(q));
  }, [orgList, search]);

  const gridRef = useGsapEntrance({ targets: ".org-card", y: 14, duration: 0.35, stagger: 0.05 }, [
    filteredOrgs.length,
    isPending,
  ]);

  async function handleSelectOrg(orgId: string) {
    setSwitchingId(orgId);
    setError("");
    try {
      const result = await authClient.organization.setActive({ organizationId: orgId });
      if (result.error) {
        setError(result.error.message ?? "Could not switch Organization.");
        setSwitchingId(null);
        return;
      }
      router.push("/dashboard/projects");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not switch Organization.");
      setSwitchingId(null);
    }
  }

  async function handleCreateOrg(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = orgName.trim();
    const slug = trimmed
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    if (!trimmed || !slug) {
      setError("Please enter a valid organization name.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const result = await authClient.organization.create({
        name: trimmed,
        slug: `${slug}-${crypto.randomUUID().slice(0, 8)}`,
      });

      if (result.error) {
        setError(result.error.message || "Failed to create organization.");
        setBusy(false);
        return;
      }

      setModalOpen(false);
      setOrgName("");
      toast.success("Organization created", `"${trimmed}" is ready.`);
      // Navigate to projects
      router.push("/dashboard/projects");
    } catch {
      setError("An unexpected error occurred.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[calc(100dvh_-_48px)] bg-console text-ink-console py-[48px] px-[32px]">
      <div className="max-w-[1100px] mx-auto">
        <h1 className="text-[28px]! font-semibold! tracking-[-0.02em]! text-ink mt-0! mb-[24px]! mx-0!">Your organizations</h1>

        <div className="flex items-center justify-between gap-[16px] mb-[24px]">
          <div className="relative w-[280px] max-w-full">
            <Search className="absolute left-[12px] top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-[#6a6875] pointer-events-none" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search for an organization"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="orgs-search-input bg-surface w-full h-[36px] py-0 pr-[32px] pl-[34px] rounded-control border border-[#282631] text-ink-console text-[13px]! outline-none [transition:border-color_150ms] focus:border-[var(--color-accent)]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-[10px] top-1/2 -translate-y-1/2 bg-transparent border-0 text-[#6a6875] cursor-pointer p-[2px] flex hover:text-ink-console"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            type="button"
            className="supabase-btn-green"
            onClick={() => {
              setError("");
              setModalOpen(true);
            }}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>New organization</span>
          </button>
        </div>

        {isPending ? (
          <div className="orgs-grid grid gap-[16px] grid-cols-[repeat(auto-fill,minmax(320px,1fr))]" aria-label="Loading organizations">
            {[1, 2].map((n) => (
              <div key={n} className="flex items-center gap-[16px] py-[16px] px-[20px] rounded-card bg-surface border border-[var(--color-surface-raised)] min-h-[70px]" aria-hidden="true">
                <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] w-9 h-9 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-4 rounded w-32" />
                  <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-3 rounded w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredOrgs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-[60px] px-[24px] bg-surface border border-dashed border-[#26242f] rounded-card text-center">
            {search ? (
              <>
                <p className="text-zinc-400">No organizations match &ldquo;{search}&rdquo;.</p>
                <button
                  type="button"
                  className="supabase-btn-secondary font-medium focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] inline-flex items-center justify-center min-h-[38px] rounded-card border border-[#2a2834] bg-[#181720] [box-shadow:0_1px_2px_rgba(0,0,0,0.2)] whitespace-nowrap no-underline [transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease,color_120ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:border-[#3b3749] [&:hover:not(:disabled)]:bg-[#201e2a] [&:active:not(:disabled)]:translate-y-[1px] disabled:opacity-[0.5] disabled:transform-none mt-3"
                  onClick={() => setSearch("")}
                >
                  Clear search
                </button>
              </>
            ) : (
              <>
                <p className="text-zinc-300 font-medium">
                  You don&apos;t have any organizations yet.
                </p>
                <p className="text-zinc-500 text-sm mt-1">
                  Create your first organization to start launching projects and managed Postgres
                  databases.
                </p>
                <button
                  type="button"
                  className="supabase-btn-green mt-4"
                  onClick={() => setModalOpen(true)}
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>Create Organization</span>
                </button>
              </>
            )}
          </div>
        ) : (
          <div ref={gridRef} className="orgs-grid grid gap-[16px] grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
            {filteredOrgs.map((org) => {
              const isSwitching = switchingId === org.id;
              return (
                <button
                  key={org.id}
                  type="button"
                  className="org-card flex items-center gap-[16px] py-[16px] px-[20px] rounded-card bg-[var(--color-surface)] border border-[var(--color-surface-raised)] cursor-pointer text-left [transition:border-color_150ms,background-color_150ms] w-full hover:bg-[#1b1a20] hover:border-[#373441]"
                  onClick={() => void handleSelectOrg(org.id)}
                  disabled={Boolean(switchingId)}
                  title={`Open ${org.name}`}
                >
                  <OrgHexIcon />
                  <div className="flex flex-col gap-[2px] min-w-0">
                    <span className="truncate text-[15px] font-semibold text-ink">{org.name}</span>
                    <span className="text-[13px] text-[#7a7886]">Free Plan</span>
                  </div>
                  {isSwitching && (
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-400 ml-auto" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal New Organization */}
      {modalOpen && (
        <ModalDialog labelledBy="modal-title" onClose={() => setModalOpen(false)}>
          <div className="supabase-modal-header flex items-center justify-between py-[18px] px-[20px]">
            <h2 id="modal-title">Create a new organization</h2>
            <button
              type="button"
              className="supabase-modal-close flex items-center justify-center w-[28px] h-[28px] rounded-control bg-transparent border-0 text-[#716f7c] cursor-pointer [transition:color_150ms,background-color_150ms] hover:text-ink-console"
              onClick={() => setModalOpen(false)}
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleCreateOrg}>
            <div className="supabase-modal-body">
              <p className="text-sm text-zinc-400 mb-4">
                Organizations group your projects, team members, and databases under a unified
                workspace.
              </p>

              <label htmlFor="modal-org-name" className="block text-[13px] font-medium text-[#c9c7d2] mb-[6px]">
                Organization name
              </label>
              <input
                id="modal-org-name"
                type="text"
                required
                placeholder="e.g. Acme Corp"
                maxLength={80}
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="supabase-modal-input w-full h-[38px] py-0 px-[12px] rounded-control bg-[#1a1920] text-ink outline-none [transition:border-color_150ms]"
                autoFocus
              />

              {error && <p className="text-xs text-rose-400 mt-2">{error}</p>}
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
                disabled={busy || !orgName.trim()}
              >
                {busy ? "Creating..." : "Create organization"}
              </button>
            </div>
          </form>
        </ModalDialog>
      )}
    </div>
  );
}
