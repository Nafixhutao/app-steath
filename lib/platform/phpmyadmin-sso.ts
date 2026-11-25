import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { ApiError } from "./api-error.ts";
import { getPlatformDomain } from "./platform-domain.ts";
import { platformEncryptionKey } from "./secrets.ts";

/**
 * The phpMyAdmin sign-in bridge, in two halves.
 *
 * `issuePhpMyAdminToken` / `consumePhpMyAdminToken` mint and verify a one-time
 * link token: signed, 60 seconds, spent on first use. `signInToPhpMyAdmin` does
 * the actual login and returns phpMyAdmin's own session cookies.
 *
 * The cookie is the reason the bridge has to run on the phpMyAdmin hostname:
 * phpMyAdmin sets `__Secure-` cookies, which a browser only returns to the exact
 * origin that set them. Caddy rewrites `/_sso*` on that host to this API.
 */

/** How long a sign-in token stays valid. */
const TOKEN_TTL_SECONDS = 60;

export type SsoTokenPayload = { databaseId: string; expiresAt: number; nonce: string };

/**
 * Where the login request goes. `PHPMYADMIN_INTERNAL_URL` is the address the
 * Control Plane dials, which is Caddy: phpMyAdmin only names its session cookies
 * `__Secure-*_https` when the request arrived over HTTPS with the right SNI and
 * referer, and a browser would not send those cookies back otherwise. A plain
 * `http://stealth-pma` login appears to succeed but produces cookies the browser
 * discards.
 */
const PHPMYADMIN_DIAL = (() => {
  const configured = process.env.PHPMYADMIN_INTERNAL_URL?.trim();
  if (!configured) {
    return { host: "caddy", port: 443 };
  }
  const parsed = new URL(configured);

  return {
    host: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)),
  };
})();

/**
 * The signing key is derived from the platform encryption key, so no new secret
 * has to be configured and rotating that key also invalidates outstanding links.
 *
 * It reuses `platformEncryptionKey` rather than reading the environment here, so
 * a missing or malformed key fails closed with the same 503 the rest of the
 * platform answers. Reading it locally used to fall back to an empty string,
 * which would sign links with a key anyone can compute.
 */
function signingKey(): Buffer {
  return createHmac("sha256", "stealth-phpmyadmin-sso").update(platformEncryptionKey()).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

/** Issues a signed link token that expires in 60 seconds. */
export function issuePhpMyAdminToken(databaseId: string): string {
  const payload: SsoTokenPayload = {
    databaseId,
    expiresAt: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    nonce: randomBytes(12).toString("base64url"),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  return `${body}.${sign(body)}`;
}

/**
 * Verifies the signature and expiry, then spends the nonce. A token that is
 * malformed, tampered with, expired, or already used is refused with the same
 * answer, so a probe cannot learn which check failed.
 */
export async function consumePhpMyAdminToken(token: string): Promise<SsoTokenPayload> {
  const invalid = () =>
    new ApiError(404, "sso_token_invalid", "This sign-in link is invalid or expired.");

  const separator = token.lastIndexOf(".");
  if (separator <= 0) {
    throw invalid();
  }

  const body = token.slice(0, separator);
  const provided = Buffer.from(token.slice(separator + 1), "utf8");

  let decoded: SsoTokenPayload;
  try {
    decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SsoTokenPayload;
  } catch {
    throw invalid();
  }
  if (!decoded || typeof decoded.databaseId !== "string" || typeof decoded.nonce !== "string") {
    throw invalid();
  }
  if (typeof decoded.expiresAt !== "number" || decoded.expiresAt * 1000 <= Date.now()) {
    throw invalid();
  }

  const expected = Buffer.from(sign(body), "utf8");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw invalid();
  }
  if (!(await spendNonce(decoded.nonce))) {
    throw invalid();
  }

  return decoded;
}

/** Records a nonce as spent. Returns false when it was already used. */
async function spendNonce(nonce: string): Promise<boolean> {
  return markSsoTokenUsed(nonce);
}

/**
 * Nonces already exchanged for a session, with the moment they stop mattering.
 *
 * The Control Plane runs as a single process, so an in-memory set is enough to
 * make a token genuinely single-use and needs no extra infrastructure. An entry
 * is only useful for as long as its token is valid, so expired nonces are swept
 * on each call: the set stays bounded by the number of sign-ins in the last
 * minute, not by the lifetime of the process.
 */
const spentNonces = new Map<string, number>();

/** A soft cap so a burst of sign-ins cannot grow the map without bound. */
const MAX_SPENT_NONCES = 10_000;

/**
 * Records a one-time token as spent. Returns false when it was already used.
 *
 * A `Set`-like check plus insert is synchronous, so two concurrent requests
 * carrying the same token cannot both win: the second sees the first's entry.
 */
export async function markSsoTokenUsed(nonce: string): Promise<boolean> {
  const now = Date.now();
  for (const [key, expiresAt] of spentNonces) {
    if (expiresAt > now) {
      break;
    }
    spentNonces.delete(key);
  }

  if (spentNonces.has(nonce)) {
    return false;
  }
  // Dropping the oldest entry keeps a pathological burst from holding memory
  // forever; it only makes the very oldest token replayable within its window.
  if (spentNonces.size >= MAX_SPENT_NONCES) {
    const oldest = spentNonces.keys().next().value;
    if (oldest !== undefined) {
      spentNonces.delete(oldest);
    }
  }

  spentNonces.set(nonce, now + TOKEN_TTL_SECONDS * 1000);

  return true;
}

export type PhpMyAdminSession = { cookies: string[] };

/**
 * Logs in to the shared phpMyAdmin as one tenant and returns the `Set-Cookie`
 * values to forward to the browser.
 *
 * The cookies are returned in full (attributes included) rather than as a name
 * value pair: phpMyAdmin marks them `secure`, `HttpOnly` and `SameSite=Strict`,
 * and forwarding a stripped `name=value` would make the browser reject a
 * `__Secure-` cookie or send it in the wrong context.
 *
 * The password is used here and never returned, logged, or placed in a URL.
 */
export async function signInToPhpMyAdmin(input: {
  username: string;
  password: string;
}): Promise<PhpMyAdminSession> {
  const hostname = phpMyAdminHostname();
  const jar = new Map<string, string>();

  const loginPage = await pmaRequest(hostname, "/index.php", { method: "GET" }, jar);
  const token = extractHidden(loginPage.body, "token");
  const setSession = extractHidden(loginPage.body, "set_session");
  if (!token || !setSession) {
    throw new ApiError(502, "phpmyadmin_login_failed", "phpMyAdmin did not return its login form.");
  }

  const body = new URLSearchParams({
    pma_username: input.username,
    pma_password: input.password,
    server: "1",
    target: "index.php",
    token,
    set_session: setSession,
  }).toString();

  const login = await pmaRequest(
    hostname,
    "/index.php?route=/",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(Buffer.byteLength(body)),
        // phpMyAdmin rejects a login whose referer is not its own origin.
        referer: `https://${hostname}/index.php`,
      },
      body,
    },
    jar,
  );

  // A successful login answers 302 to the UI and sets the auth cookies; a failed
  // one re-renders the form. Both can carry a fresh session cookie, so the
  // status and the cookies are checked rather than the body alone.
  const authed = login.setCookie.some((cookie) => cookie.startsWith("__Secure-pmaAuth-1_https="));
  if (login.status !== 302 || !authed) {
    throw new ApiError(
      502,
      "phpmyadmin_login_failed",
      "phpMyAdmin rejected the Database credentials.",
    );
  }

  return { cookies: login.setCookie };
}

/** One hidden input value from phpMyAdmin's login form. */
function extractHidden(html: string, name: string): string | null {
  const match = new RegExp(`name="${name}"\\s+value="([^"]+)"`).exec(html);

  return match ? match[1] : null;
}

/** The public hostname phpMyAdmin answers on, which is also its cookie origin. */
function phpMyAdminHostname(): string {
  const label = process.env.PHPMYADMIN_HOSTNAME?.trim();
  if (label) {
    return label;
  }

  return `pma.${getPlatformDomain()}`;
}

/**
 * Performs one request against phpMyAdmin over HTTPS, addressing Caddy directly
 * but presenting the public hostname as both SNI and `Host`.
 *
 * `fetch` cannot set SNI or `Host`, and phpMyAdmin only chooses its secure cookie
 * names when it sees the public host over TLS. A duplicate `Set-Cookie` name
 * keeps the last value, which is what a browser does and what phpMyAdmin expects.
 */
async function pmaRequest(
  hostname: string,
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
  jar: Map<string, string>,
): Promise<{ status: number; body: string; setCookie: string[] }> {
  const result = await new Promise<{
    status: number;
    body: string;
    setCookie: string[];
  }>((resolve, reject) => {
    const outgoing = httpsRequest(
      {
        host: PHPMYADMIN_DIAL.host,
        port: PHPMYADMIN_DIAL.port,
        path,
        method: init.method,
        servername: hostname,
        // The certificate is Caddy's internal one: the hop is inside the platform
        // network, and the browser sees the real certificate between Caddy and
        // itself. Verification here would fail on a name Caddy mints locally.
        rejectUnauthorized: false,
        headers: {
          host: hostname,
          ...(jar.size > 0 ? { cookie: [...jar.values()].join("; ") } : {}),
          ...(init.headers ?? {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const setCookie = response.headers["set-cookie"] ?? [];
          // Remember the pair so the next request in the flow carries the
          // session phpMyAdmin just issued.
          for (const raw of setCookie) {
            const pair = raw.split(";")[0];
            if (pair) {
              jar.set(pair.split("=")[0], pair);
            }
          }
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            setCookie,
          });
        });
      },
    );

    outgoing.on("error", reject);
    // A slow login must not hang the dashboard request forever.
    outgoing.setTimeout(15_000, () => {
      outgoing.destroy(new Error("phpMyAdmin did not answer in time."));
    });
    if (init.body) {
      outgoing.write(init.body);
    }
    outgoing.end();
  });

  return result;
}

export const PHPMYADMIN_SSO_TTL_SECONDS = TOKEN_TTL_SECONDS;
