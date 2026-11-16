import { timingSafeEqual } from "node:crypto";
import { isCertificateHostnameAllowed } from "@/lib/platform/custom-domains";

/**
 * Caddy's on-demand TLS permission endpoint. Caddy calls it before issuing a
 * certificate; the platform answers 200 only for a Platform Subdomain or an
 * active Custom Domain. The Node Agent passes its token in the query string
 * because Caddy's `ask` request carries no custom headers.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const hostname = url.searchParams.get("domain") ?? url.searchParams.get("hostname") ?? "";

  if (!tokenMatches(token)) {
    return Response.json({ allowed: false }, { status: 401 });
  }

  const allowed = await isCertificateHostnameAllowed(hostname);

  return Response.json({ allowed }, { status: allowed ? 200 : 403 });
}

function tokenMatches(candidate: string): boolean {
  const expected = process.env.AGENT_TOKEN ?? "";
  if (!expected) {
    return false;
  }

  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  if (candidateBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(candidateBytes, expectedBytes);
}
