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
    <div className="db-cred-row [@media(max-width:400px)]:py-[10px] [@media(max-width:400px)]:px-[12px] flex flex-col gap-[4px] py-[12px] px-[14px] min-w-0">
      <span className="flex items-center gap-[8px] text-[10.5px] uppercase tracking-[0.04em] text-[#636170]">
        {label}
        {/* The copied confirmation is written out, not just an icon, so it is
            readable at a glance and announced to a screen reader. */}
        {copied ? (
          <span className="db-cred-copied text-[10px] font-semibold tracking-[0.02em] text-accent" role="status">
            Tersalin
          </span>
        ) : null}
      </span>
      <div className="flex items-start gap-[10px] min-w-0">
        <span className="db-cred-value text-ink min-w-0 text-[14px] leading-[1.5] [overflow-wrap:anywhere] is-mono">{value}</span>
        <button
          type="button"
          className="bg-[#1f1e26] [&:hover:not(:disabled)]:bg-[#272532] focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] flex-none inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-0 rounded-control border border-[#2e2c39] text-[#8e8c99] cursor-pointer [transition:background-color_120ms,color_120ms,border-color_120ms] [&:hover:not(:disabled)]:border-[#3a3846] [&:hover:not(:disabled)]:text-ink disabled:opacity-[0.55] disabled:cursor-not-allowed"
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
    <div className="db-cred-row [@media(max-width:400px)]:py-[10px] [@media(max-width:400px)]:px-[12px] flex flex-col gap-[4px] py-[12px] px-[14px] min-w-0">
      <span className="flex items-center gap-[8px] text-[10.5px] uppercase tracking-[0.04em] text-[#636170]">
        Password
        {copied ? (
          <span className="db-cred-copied text-[10px] font-semibold tracking-[0.02em] text-accent" role="status">
            Tersalin
          </span>
        ) : null}
      </span>
      <div className="flex items-start gap-[10px] min-w-0">
        <span className="db-cred-value text-ink min-w-0 text-[14px] leading-[1.5] [overflow-wrap:anywhere] is-mono min-h-[21px]" aria-live="polite">
          {loading ? (
            <span className="text-[#716f7c] [font-family:inherit]">
              <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Loading…
            </span>
          ) : visible && password ? (
            password
          ) : password ? (
            "••••••••••••••••"
          ) : (
            <span className="text-[#716f7c] [font-family:inherit]">Hidden</span>
          )}
        </span>
      </div>
      <div className="db-cred-password-actions [@media(max-width:400px)]:w-full flex flex-wrap gap-[8px] mt-[8px]">
        <button
          type="button"
          className="db-cred-action focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] bg-[#1f1e26] text-[12.5px] font-medium [&:hover:not(:disabled)]:bg-[#272532] disabled:opacity-[0.55] disabled:cursor-not-allowed inline-flex items-center justify-center gap-[6px] min-h-[44px] py-[8px] px-[14px] rounded-control border border-[#2e2c39] text-[#d4d4d8] cursor-pointer [transition:background-color_120ms,color_120ms,border-color_120ms] [&:hover:not(:disabled)]:border-[#3a3846] [&:hover:not(:disabled)]:text-ink"
          onClick={() => void reveal()}
          disabled={loading}
          aria-label={visible ? "Hide password" : "Reveal password"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {visible ? "Hide" : "Reveal"}
        </button>
        <button
          type="button"
          className="db-cred-action focus-visible:outline-2 focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] bg-[#1f1e26] text-[12.5px] font-medium [&:hover:not(:disabled)]:bg-[#272532] disabled:opacity-[0.55] disabled:cursor-not-allowed inline-flex items-center justify-center gap-[6px] min-h-[44px] py-[8px] px-[14px] rounded-control border border-[#2e2c39] text-[#d4d4d8] cursor-pointer [transition:background-color_120ms,color_120ms,border-color_120ms] [&:hover:not(:disabled)]:border-[#3a3846] [&:hover:not(:disabled)]:text-ink"
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
