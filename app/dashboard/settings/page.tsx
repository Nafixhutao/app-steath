"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient, useActiveMember, useActiveOrganization } from "@/lib/auth-client";

export default function SettingsPage() {
  const router = useRouter();
  const { data: organization } = useActiveOrganization();
  const { data: activeMember } = useActiveMember();
  const [name, setName] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isOwner = activeMember?.role === "owner";

  const organizationName = organization?.name ?? "";
  useEffect(() => {
    let cancelled = false;
    // Sync the form with the latest Organization name from the server.
    void Promise.resolve(organizationName).then((value) => {
      if (!cancelled) setName(value);
    });
    return () => {
      cancelled = true;
    };
  }, [organizationName]);

  async function rename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization || !name.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    const result = await authClient.organization.update({
      organizationId: organization.id,
      data: { name: name.trim() },
    });
    setBusy(false);
    if (result.error) setError(result.error.message ?? "Could not rename this Organization.");
    else {
      setNotice("Organization name updated.");
      await authClient.getSession({ query: { disableCookieCache: true } });
    }
  }

  async function deleteOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/organizations/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation, organizationId: organization.id }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not delete this Organization.");
      router.push("/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete this Organization.");
      setBusy(false);
    }
  }

  return (
    <div className="dashboard-content">
      <div className="dashboard-page-heading">
        <div>
          <h1>Organization settings</h1>
          <p>Manage {organization?.name ?? "this Organization"}.</p>
        </div>
        <span className="role-label">{activeMember?.role ?? ""}</span>
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
      <section className="dashboard-section" aria-labelledby="details-heading">
        <div className="dashboard-section-heading">
          <h2 id="details-heading">Details</h2>
        </div>
        {isOwner ? (
          <form className="organization-settings-form" onSubmit={rename}>
            <label>
              Organization name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                required
              />
            </label>
            <button
              className="create-project-button"
              type="submit"
              disabled={busy || name.trim() === organization?.name}
            >
              {busy ? "Saving..." : "Save name"}
            </button>
          </form>
        ) : (
          <p className="settings-readonly">
            {activeMember?.role === "admin"
              ? "Only an owner can rename this Organization."
              : "Only an owner can rename or delete this Organization."}
          </p>
        )}
      </section>
      {isOwner ? (
        <section
          className="dashboard-section organization-danger-zone"
          aria-labelledby="danger-heading"
        >
          <div className="dashboard-section-heading">
            <h2 id="danger-heading">Danger zone</h2>
          </div>
          <p>
            Deleting this Organization permanently removes its memberships and pending invitations.
          </p>
          <form className="organization-settings-form" onSubmit={deleteOrganization}>
            <label>
              Type <strong>{organization?.name}</strong> to confirm
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                required
              />
            </label>
            <button
              className="dashboard-danger-button"
              type="submit"
              disabled={busy || confirmation !== organization?.name}
            >
              {busy ? "Deleting..." : "Delete Organization"}
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
