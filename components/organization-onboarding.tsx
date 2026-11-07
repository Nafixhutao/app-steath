"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

/**
 * Shown when a signed-in User has no Organization membership left, for example
 * after deleting their last Organization. Without this gate the dashboard would
 * render with a stale fallback name and no way to recover.
 */
export function OrganizationOnboarding() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    const slug = trimmed
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!trimmed || !slug) {
      setError("Enter an Organization name using letters or numbers.");
      return;
    }

    setBusy(true);
    setError("");
    const result = await authClient.organization.create({
      name: trimmed,
      slug: `${slug}-${crypto.randomUUID().slice(0, 8)}`,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Could not create this Organization.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="dashboard-content">
      <div className="dashboard-page-heading">
        <div>
          <h1>Create an Organization</h1>
          <p>You are not a Member of any Organization yet. Create one to continue.</p>
        </div>
      </div>
      <section className="dashboard-section" aria-labelledby="create-organization-heading">
        <div className="dashboard-section-heading">
          <h2 id="create-organization-heading">Organization details</h2>
        </div>
        <form className="organization-settings-form" onSubmit={create}>
          <label>
            Organization name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
            />
          </label>
          <button className="create-project-button" type="submit" disabled={busy}>
            {busy ? "Creating..." : "Create Organization"}
          </button>
        </form>
        {error ? (
          <p className="dashboard-alert is-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
