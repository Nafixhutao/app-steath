import { afterEach, describe, expect, it } from "vitest";
import {
  consumePhpMyAdminToken,
  issuePhpMyAdminToken,
  markSsoTokenUsed,
} from "../../lib/platform/phpmyadmin-sso.ts";

/**
 * The phpMyAdmin sign-in token is the only thing standing between a leaked URL
 * and someone else's Database, so its two properties are pinned here: the key it
 * signs with is the platform encryption key (no empty-string fallback), and a
 * token is single-use.
 */

const KEY = Buffer.alloc(32, 7).toString("base64");

afterEach(() => {
  process.env.ENV_ENCRYPTION_KEY = KEY;
});

describe("phpMyAdmin sign-in token", () => {
  it("round-trips a token it issued", async () => {
    process.env.ENV_ENCRYPTION_KEY = KEY;

    const token = issuePhpMyAdminToken("db-1");
    const payload = await consumePhpMyAdminToken(token);

    expect(payload.databaseId).toBe("db-1");
  });

  it("refuses the same token twice", async () => {
    process.env.ENV_ENCRYPTION_KEY = KEY;

    const token = issuePhpMyAdminToken("db-1");
    await consumePhpMyAdminToken(token);

    await expect(consumePhpMyAdminToken(token)).rejects.toMatchObject({
      status: 404,
      code: "sso_token_invalid",
    });
  });

  it("refuses a token signed with a different key", async () => {
    process.env.ENV_ENCRYPTION_KEY = KEY;
    const token = issuePhpMyAdminToken("db-1");

    // A different key must not verify the token. This is the whole point of
    // deriving the signing key from configuration instead of a constant.
    process.env.ENV_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

    await expect(consumePhpMyAdminToken(token)).rejects.toMatchObject({
      code: "sso_token_invalid",
    });
  });

  it("fails closed when no key is configured instead of signing with an empty one", () => {
    delete process.env.ENV_ENCRYPTION_KEY;

    // Signing with "" would let anyone who read this source forge a link. The
    // module has to refuse to issue a token at all.
    expect(() => issuePhpMyAdminToken("db-1")).toThrowError(
      expect.objectContaining({ status: 503, code: "encryption_not_configured" }),
    );
  });

  it("spends a nonce only once", async () => {
    expect(await markSsoTokenUsed("nonce-1")).toBe(true);
    expect(await markSsoTokenUsed("nonce-1")).toBe(false);
  });
});
