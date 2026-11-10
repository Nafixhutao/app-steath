import { createHash, createHmac } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Backup storage. The spec prefers an S3-compatible bucket so a lost VPS does
 * not lose the Backups too; when credentials are absent the same interface
 * writes to local disk and the dashboard warns that the copy is not durable.
 *
 * The S3 client is intentionally small: one signed PUT and one DELETE are all
 * the platform needs, so it does not pull a full SDK into the worker.
 */

export type BackupStorageProvider = "s3" | "local";

export type BackupStorage = {
  provider: BackupStorageProvider;
  put(key: string, body: Buffer): Promise<void>;
  remove(key: string): Promise<void>;
};

export type BackupStorageConfig = {
  endpoint?: string;
  bucket?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  localDir?: string;
};

const S3_SERVICE = "s3";
const SERVER_SIDE_ENCRYPTION = "AES256";

export function backupStorageConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BackupStorageConfig {
  return {
    endpoint: env.S3_ENDPOINT,
    bucket: env.S3_BUCKET,
    region: env.S3_REGION ?? "us-east-1",
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    localDir: env.BACKUP_LOCAL_DIR ?? path.join(process.cwd(), "backups"),
  };
}

/** True when the environment carries everything an S3 upload needs. */
export function hasS3Credentials(config: BackupStorageConfig): boolean {
  return Boolean(
    config.endpoint && config.bucket && config.accessKeyId && config.secretAccessKey,
  );
}

export function createBackupStorage(config: BackupStorageConfig = backupStorageConfigFromEnv()): BackupStorage {
  if (hasS3Credentials(config)) {
    return s3Storage(config);
  }

  return createLocalBackupStorage(config.localDir);
}

/**
 * A local Backup store. Exported so retention can remove a file that was stored
 * locally even after S3 credentials were added.
 */
export function createLocalBackupStorage(
  dir: string = backupStorageConfigFromEnv().localDir ??
    path.join(process.cwd(), "backups"),
): BackupStorage {
  return {
    provider: "local",
    async put(key, body) {
      const target = safeLocalPath(dir, key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body, { mode: 0o600 });
    },
    async remove(key) {
      await rm(safeLocalPath(dir, key), { force: true });
    },
  };
}

/**
 * Resolves a storage key inside the local Backup directory. Keys are generated
 * by the platform, but rejecting `..` keeps a malformed row from escaping.
 */
export function safeLocalPath(dir: string, key: string): string {
  if (!key || key.startsWith("/") || key.split("/").includes("..")) {
    throw new Error(`invalid Backup storage key: ${key}`);
  }

  return path.join(dir, ...key.split("/"));
}

function s3Storage(config: BackupStorageConfig): BackupStorage {
  const endpoint = (config.endpoint as string).replace(/\/+$/, "");
  const bucket = config.bucket as string;
  const region = config.region ?? "us-east-1";
  const accessKeyId = config.accessKeyId as string;
  const secretAccessKey = config.secretAccessKey as string;

  async function send(method: "PUT" | "DELETE", key: string, body?: Buffer): Promise<void> {
    const url = new URL(`${endpoint}/${bucket}/${encodeKey(key)}`);
    const payload = body ?? Buffer.alloc(0);
    const payloadHash = sha256Hex(payload);
    const now = new Date();
    const amzDate = formatAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);

    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (method === "PUT") {
      headers["x-amz-server-side-encryption"] = SERVER_SIDE_ENCRYPTION;
    }

    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames
      .map((name) => `${name}:${headers[name]}\n`)
      .join("");
    const signedHeaders = signedHeaderNames.join(";");
    const canonicalRequest = [
      method,
      url.pathname,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const scope = `${dateStamp}/${region}/${S3_SERVICE}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signature = hmacHex(signingKey(secretAccessKey, dateStamp, region), stringToSign);

    const response = await fetch(url, {
      method,
      headers: {
        ...headers,
        authorization:
          `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
          `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      // Copy into a plain Uint8Array so fetch accepts the bytes as a body.
      body: method === "PUT" ? new Uint8Array(payload) : undefined,
    });

    if (!response.ok) {
      throw new Error(`S3 ${method} ${key} failed with status ${response.status}`);
    }
  }

  return {
    provider: "s3",
    async put(key, body) {
      await send("PUT", key, body);
    },
    async remove(key) {
      await send("DELETE", key);
    },
  };
}

function encodeKey(key: string): string {
  if (!key || key.startsWith("/") || key.split("/").includes("..")) {
    throw new Error(`invalid Backup storage key: ${key}`);
  }

  return key.split("/").map(encodeURIComponent).join("/");
}

function sha256Hex(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: Buffer | string, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const dateKey = hmac(`AWS4${secret}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, S3_SERVICE);

  return hmac(serviceKey, "aws4_request");
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}
