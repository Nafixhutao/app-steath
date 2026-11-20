"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X, Loader2 } from "lucide-react";
import {
  authClient,
  useListOrganizations,
} from "@/lib/auth-client";
import { useToast } from "@/components/toast-context";

function OrgHexIcon() {
  return (
    <div className="org-card-hex-icon" aria-hidden="true">
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

  async function handleSelectOrg(orgId: string) {
    setSwitchingId(orgId);
    try {
      await authClient.organization.setActive({ organizationId: orgId });
      router.push("/dashboard/projects");
    } catch {
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
    <div className="orgs-page-container">
      <div className="orgs-page-inner">
        <h1 className="orgs-page-title">Your organizations</h1>

        <div className="orgs-page-toolbar">
          <div className="orgs-search-box">
            <Search className="orgs-search-icon" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search for an organization"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="orgs-search-input"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="orgs-search-clear"
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
          <div className="orgs-grid" aria-label="Loading organizations">
            {[1, 2].map((n) => (
              <div key={n} className="org-card-skeleton" aria-hidden="true">
                <div className="supabase-skeleton-box w-9 h-9 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="supabase-skeleton-box h-4 rounded w-32" />
                  <div className="supabase-skeleton-box h-3 rounded w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredOrgs.length === 0 ? (
          <div className="orgs-empty-card">
            {search ? (
              <>
                <p className="text-zinc-400">No organizations match &ldquo;{search}&rdquo;.</p>
                <button
                  type="button"
                  className="supabase-btn-secondary mt-3"
                  onClick={() => setSearch("")}
                >
                  Clear search
                </button>
              </>
            ) : (
              <>
                <p className="text-zinc-300 font-medium">You don&apos;t have any organizations yet.</p>
                <p className="text-zinc-500 text-sm mt-1">
                  Create your first organization to start launching projects and managed Postgres databases.
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
          <div className="orgs-grid">
            {filteredOrgs.map((org) => {
              const isSwitching = switchingId === org.id;
              return (
                <button
                  key={org.id}
                  type="button"
                  className="org-card"
                  onClick={() => void handleSelectOrg(org.id)}
                  disabled={Boolean(switchingId)}
                  title={`Open ${org.name}`}
                >
                  <OrgHexIcon />
                  <div className="org-card-content">
                    <span className="org-card-name">{org.name}</span>
                    <span className="org-card-plan">Free Plan</span>
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
        <div className="supabase-modal-backdrop" role="presentation">
          <div className="supabase-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className="supabase-modal-header">
              <h2 id="modal-title">Create a new organization</h2>
              <button
                type="button"
                className="supabase-modal-close"
                onClick={() => setModalOpen(false)}
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateOrg}>
              <div className="supabase-modal-body">
                <p className="text-sm text-zinc-400 mb-4">
                  Organizations group your projects, team members, and databases under a unified workspace.
                </p>

                <label htmlFor="modal-org-name" className="supabase-modal-label">
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
                  className="supabase-modal-input"
                  autoFocus
                />

                {error && <p className="text-xs text-rose-400 mt-2">{error}</p>}
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
                  disabled={busy || !orgName.trim()}
                >
                  {busy ? "Creating..." : "Create organization"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
