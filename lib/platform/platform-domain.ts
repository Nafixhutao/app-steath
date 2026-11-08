const DEFAULT_PLATFORM_DOMAIN = "localhost";

/**
 * Domain suffix used for Platform Subdomains. The experiment deploys with an
 * `<ip>.nip.io` suffix so every hostname resolves to the VPS without DNS work;
 * development falls back to `localhost`.
 */
export function getPlatformDomain(): string {
  const configured = process.env.PLATFORM_DOMAIN?.trim().replace(/^\.+|\.+$/g, "");
  return configured || DEFAULT_PLATFORM_DOMAIN;
}

/**
 * Builds the Platform Subdomain for a Service: `<service-slug>-<short-id>`.
 * The random short id keeps hostnames unique across Organizations.
 */
export function buildPlatformHostname(slug: string, shortId: string): string {
  return `${slug}-${shortId}.${getPlatformDomain()}`;
}
