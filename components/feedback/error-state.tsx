"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// The network-error classifier and message mapper, ported verbatim from
// stealth-forge's `components/feedback/error-state` (the ApiError branches
// collapse into the message the admin client throws).

const NETWORK_ERROR_PATTERN =
  /failed to fetch|networkerror|load failed|network request failed|fetch failed|the operation was aborted/i;

/** Maps any thrown value to the message its surface renders. */
export function errorMessage(error: unknown) {
  if (
    error instanceof TypeError ||
    (error instanceof Error && NETWORK_ERROR_PATTERN.test(error.message))
  ) {
    return "Could not reach the Stealth API. Check your connection and retry.";
  }
  if (error instanceof Error) {
    if (error.message.startsWith("401"))
      return "Your session has expired. Sign in again to continue.";
    if (error.message.startsWith("403"))
      return "You do not have permission to view this resource.";
    if (error.message.startsWith("404"))
      return "This resource could not be found.";
    if (error.message.startsWith("409"))
      return `This change conflicts with the current resource state. ${error.message}`;
    if (
      error.message.startsWith("400") ||
      error.message.startsWith("422")
    )
      return `The API rejected this request. ${error.message}`;
    if (error.message.startsWith("429"))
      return "The API is rate limiting requests. Try again shortly.";
    if (error.message.includes("500"))
      return "Stealth API encountered an unexpected server error. Try again shortly.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something unexpected happened.";
}

/** The bordered error card with its retry button, ported verbatim. */
export function ErrorState({
  error,
  retry,
  title = "Unable to load this view",
  className,
}: {
  error: unknown;
  retry?: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border border-[var(--projects-danger)]/20 bg-[var(--projects-danger)]/[0.04] p-4",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-[var(--projects-text)]">
        <AlertTriangle className="size-4" aria-hidden="true" /> {title}
      </div>
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <p className="m-0 text-[13px] text-[var(--projects-muted)]">
          {errorMessage(error)}
        </p>
        {retry ? (
          <button
            type="button"
            onClick={retry}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--projects-border)] bg-[var(--projects-control)] px-2.5 text-[12.5px] text-[var(--projects-text)] transition-colors hover:border-[var(--projects-border-hover)]"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" /> Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
