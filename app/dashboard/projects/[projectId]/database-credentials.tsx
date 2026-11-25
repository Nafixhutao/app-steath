"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Eye, EyeOff, Loader2 } from "lucide-react";

/**
 * One label/value pair with its own copy button.
 *
 * Long values (a 24-character schema, a readable user name) must not push the
 * card sideways on a 360px screen, so the value wraps with `break-all` in a
 * monospace face rather than being clipped: every character stays visible, which
 * matters when the value is being read or typed by hand.
 */
export function CredentialRow({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  onCopy: (label: string, value: string) => void;
  copied: boolean;
}) {
  return (
    <div className="db-cred-row">
      <span className="db-cred-label">
        {label}
        {/* The copied confirmation is written out, not just an icon, so it is
            readable at a glance and announced to a screen reader. */}
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
          onClick={() => onCopy(label, value)}
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
 * The password field.
 *
 * Nothing is fetched until the user asks: the value is not in the page payload,
 * not in the server-rendered HTML, and not in any storage. It is hidden again 15
 * seconds after it is revealed, so a secret left on screen does not stay there.
 *
 * Two explicit buttons rather than one ambiguous icon: "Reveal" shows it,
 * "Copy password" copies it, and either one performs the authenticated fetch on
 * first use.
 */
export function PasswordRow({
  fetchPassword,
  onCopied,
  onError,
  copied,
}: {
  fetchPassword: () => Promise<string>;
  onCopied: (value: string) => void;
  onError: (message: string) => void;
  copied: boolean;
}) {
  const [password, setPassword] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  // Drop the value from memory when the panel unmounts, and never leave a timer
  // running that would touch an unmounted component.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  /** Fetches once, then reuses the value for the rest of the 15 second window. */
  const load = useCallback(async (): Promise<string | null> => {
    if (password) {
      return password;
    }

    setLoading(true);
    try {
      const value = await fetchPassword();
      if (!mounted.current) {
        return null;
      }
      setPassword(value);
      if (timer.current) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => {
        if (mounted.current) {
          setPassword(null);
          setVisible(false);
        }
      }, 15_000);

      return value;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not load the password.";
      if (mounted.current) {
        onError(message);
      }

      return null;
    } finally {
      if (mounted.current) {
        setLoading(false);
      }
    }
  }, [fetchPassword, onError, password]);

  async function reveal() {
    onError("");
    if (visible) {
      setVisible(false);
      return;
    }
    const value = await load();
    if (value !== null) {
      setVisible(true);
    }
  }

  async function copy() {
    onError("");
    const value = await load();
    if (value !== null) {
      onCopied(value);
    }
  }

  return (
    <div className="db-cred-row">
      <span className="db-cred-label">
        Password
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
          ) : visible && password ? (
            password
          ) : password ? (
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
          onClick={() => void reveal()}
          disabled={loading}
          aria-label={visible ? "Hide password" : "Reveal password"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {visible ? "Hide" : "Reveal"}
        </button>
        <button
          type="button"
          className="db-cred-action"
          onClick={() => void copy()}
          disabled={loading}
          aria-label="Copy password"
        >
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          {copied ? "Tersalin" : "Copy password"}
        </button>
      </div>
    </div>
  );
}
