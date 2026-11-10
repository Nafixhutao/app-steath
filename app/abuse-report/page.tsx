"use client";

import { useState } from "react";

export default function AbuseReportPage() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/abuse-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form)),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Report could not be submitted.");
      event.currentTarget.reset();
      setMessage("Thank you. Your report has been submitted for review.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Report could not be submitted.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>Report abuse</h1>
        <p>
          Report a Service that may violate platform rules. Please include enough detail for review.
        </p>
        <form className="auth-form" onSubmit={submit}>
          <label>
            Target URL
            <input
              name="targetUrl"
              type="url"
              required
              maxLength={2048}
              placeholder="https://service.example.com"
            />
          </label>
          <label>
            Category
            <select name="category" required>
              <option value="">Choose a category</option>
              <option value="malware">Malware</option>
              <option value="phishing">Phishing</option>
              <option value="spam">Spam</option>
              <option value="copyright">Copyright</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Description
            <textarea name="description" required minLength={1} maxLength={5000} rows={6} />
          </label>
          <label>
            Email (optional)
            <input name="reporterEmail" type="email" maxLength={254} />
          </label>
          <label>
            Spam check: what is 3 + 4?
            <input name="challengeAnswer" inputMode="numeric" required />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Submitting…" : "Submit report"}
          </button>
        </form>
        {message ? <p role="status">{message}</p> : null}
      </section>
    </main>
  );
}
