const MAX_SLUG_LENGTH = 40;

/**
 * Builds a URL-safe slug from a free-form name. Shared by the API and the
 * dashboard so the slug shown while typing matches the one the server stores.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

export { MAX_SLUG_LENGTH };
