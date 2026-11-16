"use client";

import { KeyRound } from "lucide-react";
import { GitHubMark, GoogleMark } from "@/components/brand-marks";
import { cn } from "@/lib/utils";

/** Deterministic gradient avatar from the identity. When the account has a
    provider avatar it is shown as a background image (no next/image remote
    config needed); otherwise the initials gradient is used. */
export function GradientAvatar({
  email,
  url,
  size = 32,
}: {
  email: string;
  url?: string | null;
  size?: number;
}) {
  let hash = 0;
  const seed = email.toLowerCase();
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  }
  const initials = (
    seed.split(/[\s@._-]+/)[0]?.slice(0, 2) ?? "?"
  ).toUpperCase();

  if (url) {
    return (
      <span
        aria-hidden="true"
        className="shrink-0 rounded-full bg-[var(--projects-control)] bg-cover bg-center ring-1 ring-[var(--projects-border)]"
        style={{
          width: size,
          height: size,
          backgroundImage: `url(${url})`,
        }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white/90"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        background: `linear-gradient(135deg, hsl(${hash} 42% 36%), hsl(${(hash + 42) % 360} 46% 22%))`,
        boxShadow: `inset 0 0 0 1px hsl(${hash} 30% 62% / 0.28)`,
      }}
    >
      {initials}
    </span>
  );
}

/**
 * Mask an email for the admin directory so the list can be shared or viewed
 * on a screen without exposing full addresses. The first and last character of
 * the local part stay visible; the domain is preserved so the provider is
 * still recognizable.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0] ?? ""}•••${domain}`;
  const head = local[0];
  const tail = local[local.length - 1];
  return `${head}${"•".repeat(Math.min(local.length - 2, 6))}${tail}${domain}`;
}

/** Verified badge: the blue seal with a white check. The silhouette and the
    check are inline SVG so the mark stays crisp at any size and no icon
    package is added. */
const VERIFIED_SEAL =
  "M12 0C12.99 0 13.89 1.55 14.98 1.87C16.06 2.19 17.65 1.37 18.49 1.9C19.32 2.44 19.24 4.23 19.98 5.08C20.72 5.94 22.5 6.11 22.92 7.02C23.33 7.92 22.29 9.38 22.45 10.5C22.61 11.61 24.02 12.73 23.88 13.71C23.74 14.69 22.07 15.36 21.61 16.39C21.14 17.41 21.72 19.11 21.07 19.86C20.42 20.61 18.66 20.27 17.71 20.88C16.76 21.49 16.33 23.23 15.38 23.51C14.43 23.79 13.13 22.56 12 22.56C10.87 22.56 9.57 23.79 8.62 23.51C7.67 23.23 7.24 21.49 6.29 20.88C5.34 20.27 3.58 20.61 2.93 19.86C2.28 19.11 2.86 17.41 2.39 16.39C1.93 15.36 0.26 14.69 0.12 13.71C-0.02 12.73 1.39 11.61 1.55 10.5C1.71 9.38 0.67 7.92 1.08 7.02C1.5 6.11 3.28 5.94 4.02 5.08C4.76 4.23 4.68 2.44 5.51 1.9C6.35 1.37 7.94 2.19 9.02 1.87C10.11 1.55 11.01 0 12 0Z";

export function VerifiedBadge() {
  return (
    <span
      role="img"
      aria-label="Email verified"
      title="Email verified"
      className="inline-flex size-[15px] shrink-0 items-center justify-center"
    >
      <svg viewBox="0 0 24 24" className="size-full" aria-hidden="true">
        <path d={VERIFIED_SEAL} fill="#1081FA" />
        <path
          d="M7.57 12.69L10.42 15.33L16.45 9.46"
          fill="none"
          stroke="#ffffff"
          strokeWidth={2.375}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** Instance role without the `instance_` prefix. Kept for the sidebar and
    session logic; the users table no longer renders a role column. */
export type AccountRole = "owner" | "admin" | "member";

export function roleLabel(role: AccountRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** Provider mark for how the account signs in. Brand marks are the same inline
    SVGs as the sign-in screen (full-color Google G, white GitHub mark), so the
    table never shows the old washed-out grey file assets. Every provider sits
    in one uniform tile; the most recently used one carries an accent border. */
export function ProviderMark({
  provider,
  lastUsed = false,
}: {
  provider: string;
  lastUsed?: boolean;
}) {
  const label =
    provider === "github"
      ? "GitHub"
      : provider === "google"
        ? "Google"
        : "Password";
  return (
    <span
      role="img"
      aria-label={lastUsed ? `${label}, last used` : label}
      title={
        lastUsed
          ? `Signed in with ${label} · last used`
          : `Signed in with ${label}`
      }
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors",
        lastUsed
          ? "border-[color-mix(in_srgb,var(--projects-accent)_55%,var(--projects-border))] bg-[color-mix(in_srgb,var(--projects-accent)_10%,transparent)]"
          : "border-[var(--projects-border)] bg-[var(--projects-control)]",
      )}
    >
      {provider === "github" ? (
        <GitHubMark />
      ) : provider === "google" ? (
        <GoogleMark />
      ) : (
        <KeyRound
          size={14}
          strokeWidth={1.8}
          aria-hidden="true"
          className="text-[var(--projects-muted)]"
        />
      )}
    </span>
  );
}

/** The sign-in methods an account has, with the most recent one emphasized. */
export function SignInMethods({
  providers,
  lastMethod,
}: {
  providers: string[];
  lastMethod?: string;
}) {
  const methods = providers.length > 0 ? providers : ["password"];
  return (
    <span className="inline-flex items-center gap-1.5">
      {methods.map((provider) => (
        <ProviderMark
          key={provider}
          provider={provider}
          lastUsed={provider === lastMethod}
        />
      ))}
      {methods.length === 1 && methods[0] === "password" ? (
        <span className="truncate text-[12px] text-[var(--projects-muted)]">
          Password
        </span>
      ) : null}
    </span>
  );
}
