import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { authConfig } from "./auth-config";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const auth = betterAuth({
  ...authConfig,
  database: pool,
});

type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;

/**
 * Per-request session memoization. A route's layout and its page both resolve
 * the same session, and the Admin overview resolves it a third time for the
 * greeting; `auth.api.getSession` is a database round trip each time.
 *
 * `React.cache()` only exists inside a React render, so this is a WeakMap keyed
 * by the request `Headers` instead: route handlers get the same deduplication.
 * The key lives only as long as its request, so a session can never leak into
 * another request.
 */
const sessionByHeaders = new WeakMap<Headers, Promise<AuthSession>>();

export function getSession(headers: Headers): Promise<AuthSession> {
  const cached = sessionByHeaders.get(headers);
  if (cached) {
    return cached;
  }

  const session = auth.api.getSession({ headers });
  sessionByHeaders.set(headers, session);
  return session;
}
