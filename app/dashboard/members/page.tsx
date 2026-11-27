"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  Plus,
  Search,
  Mail,
  Shield,
  Crown,
  Copy,
  Check,
  Trash2,
  X,
  Loader2,
  LogOut,
  Clock,
  AlertTriangle,
} from "lucide-react";
import {
  authClient,
  useActiveOrganization,
  useActiveMember,
  useListOrganizations,
} from "@/lib/auth-client";
import { getError } from "@/lib/resource";
import { getInitials } from "@/components/identity";
import { useToast } from "@/components/toast-context";
import { ModalDialog } from "@/components/supabase-modal";

type MemberRow = {
  id: string;
  userId: string;
  role: string;
  createdAt: string | Date;
  user: { id: string; name: string; email: string; image?: string | null };
};

type InvitationRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string | Date;
};

type InviteRole = "member" | "admin";

export default function MembersPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { data: organization } = useActiveOrganization();
  const { data: activeMember } = useActiveMember();
  const { data: organizations } = useListOrganizations();

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  // Invite Modal State
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("member");
  const [inviteUrl, setInviteUrl] = useState("");
  const [copiedInvite, setCopiedInvite] = useState(false);

  // Remove Modal State
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const organizationId = organization?.id;
  // Better Auth can store more than one role per member as a comma-separated
  // string, so membership checks must look at the parsed set, not the raw value.
  const activeRoles = activeMember?.role.split(",").map((role) => role.trim()) ?? [];
  const canManage = activeRoles.includes("owner") || activeRoles.includes("admin");
  const organizationName =
    organizations?.find((item) => item.id === organizationId)?.name ?? "this Organization";
  const canRemoveMembers = activeRoles.includes("owner");

  const refreshTicket = useRef(0);

  async function refresh() {
    const ticket = ++refreshTicket.current;
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [memberResult, invitationResult] = await Promise.all([
        authClient.organization.listMembers({ query: { organizationId } }),
        canManage
          ? authClient.organization.listInvitations({ query: { organizationId } })
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (ticket !== refreshTicket.current) return;

      if (memberResult.error) {
        setError(memberResult.error.message ?? "Could not load members.");
        setLoading(false);
        return;
      }

      setMembers((memberResult.data?.members ?? []) as unknown as MemberRow[]);

      if (invitationResult.data) {
        const result = invitationResult.data as unknown;
        const all = Array.isArray(result)
          ? (result as InvitationRow[])
          : ((result as { invitations?: InvitationRow[] }).invitations ?? []);
        const now = Date.now();
        setInvitations(
          all.filter(
            (invitation) =>
              invitation.status === "pending" && new Date(invitation.expiresAt).getTime() > now,
          ),
        );
      }
    } catch (cause) {
      if (ticket === refreshTicket.current) setError(getError(cause));
    } finally {
      if (ticket === refreshTicket.current) setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, canManage]);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((member) => {
      // Role filters match any of a member's comma-separated roles.
      if (
        roleFilter !== "all" &&
        !member.role.split(",").some((role) => role.trim() === roleFilter)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        member.user.name.toLowerCase().includes(q) || member.user.email.toLowerCase().includes(q)
      );
    });
  }, [members, roleFilter, search]);

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    setBusy(true);
    setError("");
    try {
      const result = await authClient.organization.inviteMember({
        email: email.trim(),
        role: inviteRole as "member" | "admin",
        organizationId,
      });

      if (result.error) throw result.error;
      const invitation = result.data as { id: string };
      const generatedUrl = `${window.location.origin}/invite/${invitation.id}`;
      setInviteUrl(generatedUrl);
      setEmail("");
      toast.success("Invitation generated", "Share the link with your team member.");
      await refresh();
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  function copyInvite() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(inviteUrl).then(() => {
        setCopiedInvite(true);
        toast.success("Copied to clipboard", inviteUrl);
        setTimeout(() => setCopiedInvite(false), 2000);
      });
    }
  }

  async function changeRole(memberId: string, role: string) {
    if (!organizationId) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/organizations/members/${encodeURIComponent(memberId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: { message?: string } };
        setError(result.error?.message ?? "Could not update the member role.");
      } else {
        toast.success("Role updated", `Member role updated to ${role}.`);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMember() {
    if (!removeTarget) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/organizations/members/${encodeURIComponent(removeTarget.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const result = (await response.json()) as { error?: { message?: string } };
        setError(result.error?.message ?? "Could not remove this member.");
      } else {
        toast.success("Member removed", `${removeTarget.user.email} removed from organization.`);
        setRemoveTarget(null);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancelInvitation(invitationId: string) {
    setBusy(true);
    try {
      const result = await authClient.organization.cancelInvitation({ invitationId });
      if (result.error) {
        setError(result.error.message ?? "Could not cancel this invitation.");
      } else {
        toast.success("Invitation revoked", "The invitation link has been invalidated.");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function leaveOrganization() {
    if (!window.confirm(`Leave ${organizationName}? You will lose access to its resources.`)) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/organizations/leave", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const result = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        setError(result.error?.message ?? "Could not leave this Organization.");
      } else {
        toast.success("Left organization", `You left ${organizationName}.`);
        router.push("/dashboard/organizations");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-[28px] pb-[64px] px-[36px] max-w-[1200px] mx-auto w-full">
      {/* Page Header */}
      <header className="flex items-center justify-between flex-wrap gap-[16px] mb-[24px]">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-[40px] h-[40px] rounded-panel bg-[#1a1922] border border-[#282633] shrink-0" aria-hidden="true">
            <Users className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-[24px] font-semibold! tracking-[-0.02em]! text-ink m-0 leading-[1.2]!">Team Members</h1>
            <p className="text-[13px] text-[#8e8c99] mt-[3px]">
              Manage team access, invitations, and role-based permissions in {organizationName}.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {!activeRoles.includes("owner") && (
            <button
              type="button"
              className="supabase-btn-secondary text-rose-400 hover:text-rose-300"
              onClick={() => void leaveOrganization()}
              disabled={busy}
            >
              <LogOut className="w-3.5 h-3.5 mr-1.5" />
              <span>Leave</span>
            </button>
          )}

          {canManage && (
            <button
              type="button"
              className="supabase-btn-green"
              onClick={() => {
                setError("");
                setInviteUrl("");
                setInviteModalOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
              <span>Invite Member</span>
            </button>
          )}
        </div>
      </header>

      {error ? (
        <div className="dashboard-alert is-error my-4" role="alert">
          {error}
        </div>
      ) : null}

      {/* Filter Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-[12px] mb-[20px]">
        <div className="relative w-[280px] max-w-full">
          <Search className="absolute left-[10px] top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-[#636170] pointer-events-none" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="members-search-input w-full h-[34px] py-0 pr-[28px] pl-[32px] rounded-control border border-[#282631] text-ink-console text-[13px]! outline-none [transition:border-color_150ms]"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-[8px] top-1/2 -translate-y-1/2 bg-transparent border-0 text-[#716f7c] cursor-pointer p-[2px] flex"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2.5">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="supabase-filter-select"
            aria-label="Filter by role"
          >
            <option value="all">All Roles</option>
            <option value="owner">Owners</option>
            <option value="admin">Admins</option>
            <option value="member">Members</option>
          </select>

          <span className="members-count-pill">{filteredMembers.length} Members</span>
        </div>
      </div>

      {/* Members Table */}
      <div className="members-table-card">
        {loading ? (
          <div className="p-6 space-y-4" aria-label="Loading members">
            {[1, 2, 3].map((n) => (
              <div key={n} className="flex items-center gap-3">
                <div className="supabase-skeleton-box w-9 h-9 rounded-full flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="supabase-skeleton-box h-4 w-32 rounded" />
                  <div className="supabase-skeleton-box h-3 w-48 rounded" />
                </div>
                <div className="supabase-skeleton-box h-6 w-16 rounded" />
              </div>
            ))}
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-[48px] px-[20px] text-center">
            <Users className="w-8 h-8 text-zinc-600 mb-2" />
            <p className="text-sm text-zinc-300 font-medium">No team members match this query</p>
            <p className="text-xs text-zinc-500 mt-1">
              {search
                ? "Try searching with a different term."
                : "Invite people to collaborate on your projects."}
            </p>
          </div>
        ) : (
          <table className="members-table">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Role</th>
                <th scope="col">Joined</th>
                {canRemoveMembers ? (
                  <th scope="col" className="text-right">
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {filteredMembers.map((member) => {
                const isCurrentUser = member.userId === activeMember?.userId;
                // Member rows can also carry comma-separated roles; an owner is
                // anyone whose role set includes "owner".
                const memberRoles = member.role.split(",").map((role) => role.trim());
                const isOwner = memberRoles.includes("owner");
                const isAdmin = memberRoles.includes("admin");

                return (
                  <tr key={member.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-[34px] h-[34px] rounded-[50%] bg-[#24222f] border border-[#322f3e] text-accent font-semibold text-[12px] shrink-0" aria-hidden="true">
                          <span>{getInitials(member.user.name || member.user.email)}</span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[13.5px] font-semibold text-ink">{member.user.name}</span>
                            {isCurrentUser && <span className="text-[10px] font-semibold py-[1px] px-[5px] rounded-control-sm bg-[rgba(62,207,142,0.1)] text-accent border border-[rgba(62,207,142,0.25)]">You</span>}
                          </div>
                          <span className="block text-[11.5px] text-[#716f7c] [font-family:monospace]">{member.user.email}</span>
                        </div>
                      </div>
                    </td>

                    <td>
                      {activeRoles.includes("owner") && !isOwner ? (
                        <select
                          aria-label={`Role for ${member.user.email}`}
                          value={member.role}
                          disabled={busy}
                          onChange={(e) => void changeRole(member.id, e.target.value)}
                          className="h-[28px] py-0 px-[8px] rounded-control-sm bg-[#1a1921] border border-[#2c2a38] text-ink-console text-[12px] outline-none cursor-pointer focus:border-accent"
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : (
                        <span
                          className={`members-role-badge ${
                            isOwner ? "is-owner" : isAdmin ? "is-admin" : "is-member"
                          }`}
                        >
                          {isOwner && <Crown className="w-3 h-3 mr-1" />}
                          {isAdmin && <Shield className="w-3 h-3 mr-1" />}
                          <span>{member.role}</span>
                        </span>
                      )}
                    </td>

                    <td className="text-xs text-zinc-400">
                      {new Date(member.createdAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>

                    {canRemoveMembers && (
                      <td className="text-right">
                        {!isCurrentUser && !isOwner && (
                          <button
                            type="button"
                            className="text-zinc-400 hover:text-rose-400 inline-flex items-center justify-center w-[28px] h-[28px] rounded-control bg-transparent border border-transparent cursor-pointer [transition:all_120ms] hover:bg-[rgba(244,63,94,0.1)] hover:border-[rgba(244,63,94,0.2)]"
                            disabled={busy}
                            onClick={() => setRemoveTarget(member)}
                            title={`Remove ${member.user.name || member.user.email}`}
                            aria-label={`Remove ${member.user.name || member.user.email}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pending Invitations Section */}
      {canManage && invitations.length > 0 && (
        <div className="mt-8 space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-white">Pending Invitations</h2>
            <span className="members-count-pill">{invitations.length}</span>
          </div>

          <div className="members-table-card">
            <table className="members-table">
              <thead>
                <tr>
                  <th scope="col">Invited Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Expires</th>
                  <th scope="col" className="text-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-zinc-500" />
                        <span className="text-sm text-zinc-200 font-mono">{invitation.email}</span>
                      </div>
                    </td>
                    <td>
                      <span className="members-role-badge is-member">{invitation.role}</span>
                    </td>
                    <td className="text-xs text-zinc-400">
                      {new Date(invitation.expiresAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="supabase-btn-secondary text-xs text-rose-400 hover:text-rose-300 py-1 px-2.5 h-7"
                        disabled={busy}
                        onClick={() => void cancelInvitation(invitation.id)}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Invite Member */}
      {inviteModalOpen && (
        <ModalDialog labelledBy="invite-modal-title" onClose={() => setInviteModalOpen(false)}>
          <div className="supabase-modal-header">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-emerald-400" />
              <h2 id="invite-modal-title">Invite Team Member</h2>
            </div>
            <button
              type="button"
              className="supabase-modal-close"
              onClick={() => setInviteModalOpen(false)}
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {inviteUrl ? (
            <div className="supabase-modal-body space-y-4">
              <div className="p-3.5 rounded-lg bg-emerald-950/20 border border-emerald-800/40 text-emerald-300 text-xs">
                Invitation link created! Send this link to your team member to let them join{" "}
                {organizationName}.
              </div>

              <div>
                <label htmlFor="invitation-link-input" className="supabase-modal-label">
                  Invitation URL
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="invitation-link-input"
                    readOnly
                    value={inviteUrl}
                    className="supabase-modal-input font-mono text-xs select-all"
                  />
                  <button
                    type="button"
                    className="supabase-btn-green flex-shrink-0"
                    onClick={copyInvite}
                  >
                    {copiedInvite ? (
                      <>
                        <Check className="w-3.5 h-3.5 mr-1" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 mr-1" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="supabase-modal-footer">
                <button
                  type="button"
                  className="supabase-btn-secondary"
                  onClick={() => {
                    setInviteUrl("");
                    setInviteModalOpen(false);
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={invite}>
              <div className="supabase-modal-body space-y-4">
                <div>
                  <label htmlFor="invite-email-input" className="supabase-modal-label">
                    Email address
                  </label>
                  <input
                    id="invite-email-input"
                    type="email"
                    required
                    placeholder="collaborator@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="supabase-modal-input"
                    autoFocus
                  />
                </div>

                <div>
                  <label htmlFor="invite-role-select" className="supabase-modal-label">
                    Organization Role
                  </label>
                  <select
                    id="invite-role-select"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as InviteRole)}
                    className="supabase-modal-input"
                  >
                    <option value="member">
                      Member - Can view resources and trigger deployments
                    </option>
                    {activeRoles.includes("owner") && (
                      <option value="admin">
                        Admin - Full access to manage resources and invite members
                      </option>
                    )}
                  </select>
                </div>
              </div>

              <div className="supabase-modal-footer">
                <button
                  type="button"
                  className="supabase-btn-secondary"
                  onClick={() => setInviteModalOpen(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="supabase-btn-green"
                  disabled={busy || !email.trim()}
                >
                  {busy ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                      Generating...
                    </>
                  ) : (
                    "Generate Invitation Link"
                  )}
                </button>
              </div>
            </form>
          )}
        </ModalDialog>
      )}

      {/* Modal: Remove Member Confirmation */}
      {removeTarget && (
        <ModalDialog labelledBy="remove-member-dialog-title" onClose={() => setRemoveTarget(null)}>
          <div className="supabase-modal-header border-rose-900/40">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertTriangle className="w-4 h-4" />
              <h2 id="remove-member-dialog-title">Remove Member</h2>
            </div>
            <button
              type="button"
              className="supabase-modal-close"
              onClick={() => setRemoveTarget(null)}
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="supabase-modal-body space-y-3">
            <p className="text-xs text-zinc-300">
              Are you sure you want to remove{" "}
              <strong className="text-white">
                {removeTarget.user.name || removeTarget.user.email}
              </strong>{" "}
              from <strong className="text-white">{organizationName}</strong>?
            </p>
            <p className="text-xs text-zinc-500">
              They will immediately lose access to all projects, services, databases, and
              environments inside this organization.
            </p>
          </div>

          <div className="supabase-modal-footer">
            <button
              type="button"
              className="supabase-btn-secondary"
              onClick={() => setRemoveTarget(null)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="project-btn-danger"
              disabled={busy}
              onClick={() => void handleRemoveMember()}
            >
              {busy ? "Removing..." : "Remove Member"}
            </button>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}
