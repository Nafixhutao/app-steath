import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ApiError } from "./api-error.ts";

/**
 * Encryption for Environment Variable values. The key comes from the
 * environment, so the ciphertext alone is useless without access to the
 * process configuration. Values are never logged: nothing in this module
 * includes plaintext in an error message.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const VERSION = "v1";

/** What the API shows instead of a value. Fixed length, so it leaks neither the value nor its size. */
export const MASKED_VALUE = "********";

const HEX_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Reads the key from the environment. Accepts 64 hex characters or base64 that
 * decodes to exactly 32 bytes; anything else is a configuration error answered
 * at the API boundary rather than a silent fallback to a weaker key.
 */
function encryptionKey(): Buffer {
  const configured = process.env.ENV_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new ApiError(
      503,
      "encryption_not_configured",
      "ENV_ENCRYPTION_KEY is not set, so Environment Variable values cannot be stored.",
    );
  }

  const key = HEX_KEY_PATTERN.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");

  if (key.length !== KEY_BYTES) {
    throw new ApiError(
      503,
      "encryption_not_configured",
      "ENV_ENCRYPTION_KEY must decode to 32 bytes (64 hex characters or base64).",
    );
  }

  return key;
}

/**
 * Seals a value: `v1.<iv>.<tag>.<ciphertext>` with each part base64. The random
 * IV means the same plaintext seals to a different ciphertext every time, so the
 * database never shows two Services with a shared secret.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/**
 * Opens a sealed value. A ciphertext that was tampered with, or that was sealed
 * with a different key, fails the GCM check and answers with a message that
 * names the problem but not the value.
 */
export function decryptSecret(payload: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split(".");
  if (
    version !== VERSION ||
    ivPart === undefined ||
    tagPart === undefined ||
    dataPart === undefined
  ) {
    throw unreadableError();
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivPart, "base64"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw unreadableError();
  }
}

function unreadableError(): ApiError {
  return new ApiError(
    500,
    "environment_variable_unreadable",
    "A stored Environment Variable could not be read with the configured encryption key.",
  );
}
