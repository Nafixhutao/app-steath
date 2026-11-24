"use client";

import { useState } from "react";
import { getInitials } from "@/components/identity";

type AvatarUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

/**
 * One avatar source for the console: the provider photo when the account has
 * one, otherwise initials. Initials are an honest placeholder, not a generated
 * portrait, so email/password accounts never show a fake identity.
 */
export function UserAvatar({
  user,
  size = 26,
  className = "",
  decorative = false,
}: {
  user?: AvatarUser | null;
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const label = user?.name?.trim() || user?.email?.trim() || "User";
  const src = user?.image?.trim();
  const imageFailed = failedSrc !== null && failedSrc === src;

  const classes = ["user-avatar", className].filter(Boolean).join(" ");
  const dimensions = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };

  if (src && !imageFailed) {
    return (
      // Provider avatars can live on any host GitHub or Google picks. A sized
      // img avoids hard-coding a remotePatterns entry for each provider.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={decorative ? "" : label}
        className={classes}
        style={dimensions}
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(src ?? null)}
      />
    );
  }

  return (
    <span className={`${classes} user-avatar-fallback`} style={dimensions} aria-hidden="true">
      {getInitials(label)}
    </span>
  );
}
