import { beforeAll, describe, expect, it } from "vitest";
import { prepareTestDatabase } from "../helpers/database";

let isCertificateHostnameAllowed: (typeof import("@/lib/platform/custom-domains"))["isCertificateHostnameAllowed"];

beforeAll(async () => {
  await prepareTestDatabase();
  ({ isCertificateHostnameAllowed } = await import("@/lib/platform/custom-domains"));
});

describe("isCertificateHostnameAllowed", () => {
  it("allows the fixed hostname the Cloudflare Tunnel uses as its TLS SNI", async () => {
    // The tunnel dials `https://caddy:443`, so Caddy asks for a certificate for
    // `caddy` and matches the route on the Host header it forwards.
    await expect(isCertificateHostnameAllowed("caddy")).resolves.toBe(true);
    await expect(isCertificateHostnameAllowed(" CADDY. ")).resolves.toBe(true);
  });

  it("rejects a name that is neither a Platform Subdomain nor a Custom Domain", async () => {
    await expect(isCertificateHostnameAllowed("not-a-service.example.test")).resolves.toBe(false);
  });

  it("rejects an empty hostname", async () => {
    await expect(isCertificateHostnameAllowed("   ")).resolves.toBe(false);
  });
});
