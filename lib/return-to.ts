/**
 * Only same-origin absolute paths may be used as a post-auth redirect.
 * A plain `startsWith("/")` check is not enough: the URL parser normalizes
 * backslashes, so "/\\evil.com" resolves to "//evil.com" (another origin).
 */
export function safeReturnTo(value: string | string[] | null | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith("/")) return null;

  const base = "http://localhost";
  try {
    const parsed = new URL(raw, base);
    if (parsed.origin !== base) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
