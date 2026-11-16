import { formatDistanceToNowStrict, format } from "date-fns";

// Intl formatter construction is comparatively expensive and formatCount runs
// during list rendering, so the two notations are built once at module scope.
const compactCountFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
});
const standardCountFormat = new Intl.NumberFormat("en-US", {
  notation: "standard",
});
// Daily metering buckets are UTC days, so this one formatter is pinned to UTC.
const utcDayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDate(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Not available";
  return format(date, "MMM d, yyyy · HH:mm");
}

/**
 * A calendar day (`YYYY-MM-DD`) as the API reports its daily buckets. Parsing a
 * date-only string yields UTC midnight, so the value is also read in UTC:
 * formatting it in the viewer's zone would show the previous day west of
 * Greenwich.
 */
export function formatUtcDay(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Not available";
  return utcDayFormat.format(date);
}

export function formatRelative(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Not available";
  // Under 45s reads better as "just now" than "0 seconds ago"; past a week a
  // relative phrase ("2 months ago") is less useful than an absolute date.
  const elapsed = Date.now() - date.getTime();
  if (elapsed >= 0 && elapsed < 45 * 1000) return "just now";
  if (elapsed > 7 * 24 * 60 * 60 * 1000) return formatDate(value);
  return `${formatDistanceToNowStrict(date, { addSuffix: true })}`;
}

const conversationDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const conversationTime = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * The chat separator's stamp: `Today 18.32` for the current day, otherwise the
 * calendar day first (`Oct 30 09.05`). The dotted 24-hour time is the
 * reference's, not a locale default.
 */
export function formatConversationStamp(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";

  const time = conversationTime.format(date).replace(":", ".");
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return `Today ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const wasYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (wasYesterday) return `Yesterday ${time}`;

  return `${conversationDay.format(date)} ${time}`;
}

export function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "Not available";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = -1;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function formatCount(value: number | null | undefined) {
  if (value === null || value === undefined) return "Not available";
  return (value > 9999 ? compactCountFormat : standardCountFormat).format(
    value,
  );
}

/** "1 record" / "12 records", with locale-formatted counts. */
export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
) {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

/**
 * Signup and OAuth both name a personal organization `<person>'s organization`.
 * The sidebar names the person, so the generated suffix is dropped there; an
 * organization the owner named themselves comes back untouched.
 */
export function organizationDisplayName(name: string | null | undefined) {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return "";
  return trimmed.replace(/\s*['’]s\s+organization$/i, "").trim();
}

export function formatDuration(value: number | null | undefined) {
  if (value === null || value === undefined) return "Not available";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}
