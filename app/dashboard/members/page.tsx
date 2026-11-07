"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  authClient,
  useActiveOrganization,
  useActiveMember,
  useListOrganizations,
} from "@/lib/auth-client";

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

function getError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

export default function MembersPage() {
  const router = useRouter();
  const { data: organization } = useActiveOrganization();
  const { data: activeMember } = useActiveMember();
  const { data: organizations } = useListOrganizations();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("member");
  const [inviteUrl, setInviteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const organizationId = organization?.id;
  const canManage = activeMember?.role === "owner" || activeMember?.role === "admin";
  const organizationName =
    organizations?.find((item) => item.id === organizationId)?.name ?? "this Organization";
  const canRemoveMembers = activeMember?.role === "owner";

  async function refresh() {
    if (!organizationId) return;
    const [memberResult, invitationResult] = await Promise.all([
      authClient.organization.listMembers({ query: { organizationId } }),
      canManage
        ? authClient.organization.listInvitations({ query: { organizationId } })
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (memberResult.error) {
      setError(memberResult.error.message ?? "Could not load members.");
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
  }

  useEffect(() => {
    // Refresh is keyed to the active Organization and permission state.
    void Promise.resolve().then(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, canManage]);

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await authClient.organization.inviteMember({
        email: email.trim(),
        role: inviteRole as "member" | "admin",
        organizationId,
      });
      if (result.error) throw result.error;
      const invitation = result.data as { id: string };
      setInviteUrl(`${window.location.origin}/invite/${invitation.id}`);
      setEmail("");
      setNotice("Invitation link created. Copy and share it with the invited person.");
      await refresh();
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteUrl);
    setNotice("Invitation link copied.");
  }

  async function changeRole(memberId: string, role: string) {
    if (!organizationId) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/organizations/members/${encodeURIComponent(memberId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    });
    setBusy(false);
    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      setError(result.error ?? "Could not update the member role.");
    } else await refresh();
  }

  async function removeMember(member: MemberRow) {
    if (!window.confirm(`Remove ${member.user.email} from ${organizationName}?`)) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/organizations/members/${encodeURIComponent(member.id)}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      setError(result.error ?? "Could not remove this member.");
    } else await refresh();
  }

  async function cancelInvitation(invitationId: string) {
    setBusy(true);
    const result = await authClient.organization.cancelInvitation({ invitationId });
    setBusy(false);
    if (result.error) setError(result.error.message ?? "Could not cancel this invitation.");
    else await refresh();
  }

  async function leaveOrganization() {
    if (!window.confirm(`Leave ${organizationName}? You will lose access to its resources.`))
      return;
    setBusy(true);
    // The leave action is not exposed by the generated client actions, so it is
    // called through the audited custom route instead of the raw endpoint.
    const response = await fetch("/api/organizations/leave", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId }),
    });
    const result = (await response.json()) as { error?: string };
    setBusy(false);
    if (!response.ok) setError(result.error ?? "Could not leave this Organization.");
    else router.push("/dashboard");
  }

  return (
    <div className="dashboard-content">
      <div className="dashboard-page-heading">
        <div>
          <h1>Members</h1>
          <p>Manage people and roles in {organizationName}.</p>
        </div>
        {activeMember?.role !== "owner" ? (
          <button
            type="button"
            className="dashboard-secondary-button"
            onClick={() => void leaveOrganization()}
            disabled={busy}
          >
            Leave Organization
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="dashboard-alert is-success" role="status">
          {notice}
        </p>
      ) : null}

      {canManage ? (
        <section className="dashboard-section" aria-labelledby="invite-heading">
          <div className="dashboard-section-heading">
            <h2 id="invite-heading">Invite a member</h2>
          </div>
          <form className="organization-invite-form" onSubmit={invite}>
            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Role
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as InviteRole)}
              >
                <option value="member">Member</option>
                {activeMember?.role === "owner" ? <option value="admin">Admin</option> : null}
              </select>
            </label>
            <button className="create-project-button" type="submit" disabled={busy}>
              {busy ? "Creating..." : "Create invitation"}
            </button>
          </form>
          {inviteUrl ? (
            <div className="invitation-link-row">
              <input aria-label="Invitation link" readOnly value={inviteUrl} />
              <button
                className="dashboard-secondary-button"
                type="button"
                onClick={() => void copyInvite()}
              >
                Copy link
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="dashboard-section" aria-labelledby="members-heading">
        <div className="dashboard-section-heading">
          <h2 id="members-heading">
            Members <span className="dashboard-count">{members.length}</span>
          </h2>
        </div>
        <div className="organization-table-wrap">
          <table className="organization-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Joined</th>
                {canRemoveMembers ? (
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td>
                    <strong>{member.user.name}</strong>
                    <small>{member.user.email}</small>
                  </td>
                  <td>
                    {activeMember?.role === "owner" && member.role !== "owner" ? (
                      <select
                        aria-label={`Role for ${member.user.email}`}
                        value={member.role}
                        disabled={busy}
                        onChange={(event) => void changeRole(member.id, event.target.value)}
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      <span className="role-label">{member.role}</span>
                    )}
                  </td>
                  <td>{new Date(member.createdAt).toLocaleDateString()}</td>
                  {canRemoveMembers ? (
                    <td>
                      {member.userId !== activeMember?.userId && member.role !== "owner" ? (
                        <button
                          type="button"
                          className="dashboard-danger-button"
                          disabled={busy}
                          onClick={() => void removeMember(member)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {members.length === 0 ? <p className="dashboard-table-empty">No members found.</p> : null}
        </div>
      </section>

      {canManage ? (
        <section className="dashboard-section" aria-labelledby="invitations-heading">
          <div className="dashboard-section-heading">
            <h2 id="invitations-heading">Pending invitations</h2>
          </div>
          <div className="organization-table-wrap">
            <table className="organization-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Expires</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td>{invitation.email}</td>
                    <td>
                      <span className="role-label">{invitation.role}</span>
                    </td>
                    <td>{new Date(invitation.expiresAt).toLocaleDateString()}</td>
                    <td>
                      <button
                        type="button"
                        className="dashboard-secondary-button"
                        disabled={busy}
                        onClick={() => void cancelInvitation(invitation.id)}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {invitations.length === 0 ? (
              <p className="dashboard-table-empty">No pending invitations.</p>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
