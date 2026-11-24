import { databaseSignInCredentials } from "@/lib/platform/databases";
import { consumePhpMyAdminToken, signInToPhpMyAdmin } from "@/lib/platform/phpmyadmin-sso";

/**
 * The phpMyAdmin sign-in bridge. Caddy rewrites `/_sso` on the phpMyAdmin host
 * to this route, so the browser ends up here on the same origin phpMyAdmin uses.
 *
 * The flow: verify the one-time token, log in server-side with that tenant's
 * credentials, then forward phpMyAdmin's own cookies on a same-origin page that
 * takes the browser to the UI. The password never reaches the browser, and the
 * token cannot be replayed.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";

  try {
    const { databaseId } = await consumePhpMyAdminToken(token);
    const credentials = await databaseSignInCredentials(databaseId);
    if (!credentials) {
      return failure("This Database no longer exists.");
    }
    if (credentials.engine !== "mysql") {
      return failure("phpMyAdmin only serves MySQL Databases.");
    }

    const session = await signInToPhpMyAdmin({
      username: credentials.username,
      password: credentials.password,
    });

    // phpMyAdmin's own cookies, forwarded with their attributes intact. They are
    // already `secure`, `HttpOnly` and `SameSite=Strict`, which is exactly why
    // the login had to happen on this host.
    //
    // phpMyAdmin emits its session cookie two or three times in one response (the
    // previous session being retired, then the new one). A browser keeps the last
    // value per name, but the order of duplicate `Set-Cookie` headers is not
    // something to rely on across browsers, so the last one is forwarded exactly
    // once and the rest are dropped.
    const response = new Response(bounce(), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    for (const cookie of dedupeCookies(session.cookies)) {
      response.headers.append("set-cookie", cookie);
    }
    // The link that carried the token must not linger in the address bar, and the
    // page itself must never be cached.
    response.headers.set("cache-control", "no-store");

    return response;
  } catch (error) {
    console.error("phpMyAdmin sign-in bridge failed", error);
    return failure("This sign-in link is invalid or expired.");
  }
}

/**
 * A same-origin bounce to the UI.
 *
 * A 302 straight to `/index.php` does not work: the navigation was started from
 * the console origin, so the browser classifies the whole redirect as cross-site
 * and withholds phpMyAdmin's `SameSite=Strict` session cookies. phpMyAdmin then
 * sees an anonymous request and issues a brand-new session, which is a login
 * screen. Returning a document on this origin first makes the follow-up
 * navigation same-site, so the cookies from this response are sent with it.
 */
function bounce(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>phpMyAdmin</title><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=/index.php">
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#f5f5f5;color:#333;font:15px/1.5 system-ui,sans-serif}p{color:#666}</style>
</head><body><p>Signing in… <a href="/index.php">continue</a></p>
<script>location.replace("/index.php")</script></body></html>`;
}

/** A plain page, because this is a browser navigation rather than an API call. */
function failure(message: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>phpMyAdmin</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#0f0f0f;color:#f4f4f5;font:15px/1.5 system-ui,sans-serif}main{max-width:32rem;padding:2rem;text-align:center}p{color:#a1a1aa}a{color:#3ecf8e}</style>
</head><body><main><h1>Sign-in failed</h1><p>${escapeHtml(message)}</p>
<p><a href="/index.php">Open phpMyAdmin and sign in manually</a></p></main></body></html>`;

  return new Response(html, {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Keeps the last `Set-Cookie` per cookie name, preserving order. phpMyAdmin sends
 * the same session cookie name more than once to retire an old value; forwarding
 * only the final one leaves the browser with the session the login just created
 * instead of whichever duplicate happened to arrive last.
 */
function dedupeCookies(cookies: string[]): string[] {
  const byName = new Map<string, string>();
  for (const cookie of cookies) {
    const name = cookie.split("=")[0];
    if (!name) continue;
    // Re-inserting moves the key to the end, so iteration order ends with the
    // freshest value for each name.
    byName.delete(name);
    byName.set(name, cookie);
  }

  return [...byName.values()];
}
