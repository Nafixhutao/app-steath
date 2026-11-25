import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { prepareTestDatabase } from "../helpers/database";

/**
 * The Bucket service against a real PostgreSQL and a stubbed Node Agent. The
 * Agent owns the objects; these tests own the row, the derived names, the
 * sealed secret, and the Quota around it.
 */

// Secrets use the same platform key as Environment Variables. The test
// database has no production environment, so give it a deterministic one.
process.env.ENV_ENCRYPTION_KEY ??= "a".repeat(64);

const provision = vi.fn(
  async (request: {
    bucketId: string;
    bucketName: string;
    accessKey: string;
    secretKey: string;
    public: boolean;
    quotaMb: number;
  }) => ({
    status: "ready" as const,
    healthy: true,
    public: request.public,
    usageMb: 0,
    quotaMb: request.quotaMb,
  }),
);
const read = vi.fn(async (request: { quotaMb: number }) => ({
  status: "ready" as const,
  healthy: true,
  public: true,
  usageMb: 4,
  quotaMb: request.quotaMb,
}));
const remove = vi.fn(async () => undefined);

vi.mock("@/lib/platform/node-agent", () => ({
  nodeAgent: {
    provisionStorageBucket: provision,
    readStorageBucket: read,
    removeStorageBucket: remove,
  },
}));

let pool: Pool;
let storage: typeof import("@/lib/platform/storage");
const RUN_ID = Math.random().toString(36).slice(2, 8);
const projectId = `storage-proj-${RUN_ID}`;
const organizationId = `storage-org-${RUN_ID}`;

beforeAll(async () => {
  await prepareTestDatabase();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query(
    `INSERT INTO "organization" ("id", "name", "slug", "createdAt")
     VALUES ($1, $2, $3, now()) ON CONFLICT ("id") DO NOTHING`,
    [organizationId, `Storage Org ${RUN_ID}`, `storage-org-${RUN_ID}`],
  );
  await pool.query(
    `INSERT INTO "project" ("id", "organizationId", "name", "slug")
     VALUES ($1, $2, $3, $4) ON CONFLICT ("id") DO NOTHING`,
    [projectId, organizationId, `Storage Project ${RUN_ID}`, `storage-project-${RUN_ID}`],
  );

  storage = await import("@/lib/platform/storage");
});

afterAll(async () => {
  if (pool) {
    await pool.query('DELETE FROM "storage_bucket" WHERE "projectId" = $1', [projectId]);
    await pool.query('DELETE FROM "project" WHERE "id" = $1', [projectId]);
    await pool.query('DELETE FROM "organization" WHERE "id" = $1', [organizationId]);
    await pool.end();
  }
});

const actor = () => ({ organizationId, projectId });

describe("Bucket names and derived names", () => {
  it("accepts DNS-compatible names only", () => {
    expect(storage.normalizeBucketName("assets")).toBe("assets");
    expect(() => storage.normalizeBucketName("Assets")).toThrow();
    expect(() => storage.normalizeBucketName("-assets")).toThrow();
    expect(() => storage.normalizeBucketName("ab")).toThrow();
    expect(() => storage.normalizeBucketName("a".repeat(64))).toThrow();
  });

  it("derives a stable physical name and Access Key from the id", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    const one = storage.storageObjectNames(id);
    const two = storage.storageObjectNames(id.replace(/-/g, ""));
    expect(one).toEqual(two);
    expect(one.bucket).toMatch(/^sb-[a-z0-9]{24}$/);
    expect(one.accessKey).toMatch(/^ak[a-z0-9]{16}$/);
  });
});

describe("create, list, reveal, delete", () => {
  let createdId = "";
  let secretSentToAgent = "";

  it("provisions a Bucket, seals the secret, and reveals it on demand", async () => {
    const created = await storage.createProjectStorageBucket({
      ...actor(),
      name: "assets",
      public: true,
      quotaMb: 512,
    });
    createdId = created.id;

    expect(created.status).toBe("ready");
    expect(created.healthy).toBe(true);
    expect(created.quotaMb).toBe(512);
    expect(created.endpoint).toMatch(/^https:\/\/s3\./);
    expect(created.objectName).toMatch(/^sb-[a-z0-9]{24}$/);

    secretSentToAgent = provision.mock.calls[0]![0].secretKey as string;
    const sealed = await pool.query<{ encryptedSecretKey: string }>(
      'SELECT "encryptedSecretKey" FROM "storage_bucket" WHERE "id" = $1',
      [createdId],
    );
    expect(sealed.rows[0]!.encryptedSecretKey).not.toContain(secretSentToAgent);

    await expect(
      storage.revealProjectStorageBucketSecret({ ...actor(), bucketId: createdId }),
    ).resolves.toEqual({ accessKey: created.accessKey, secretKey: secretSentToAgent });
  });

  it("lists the Bucket with the usage the node measured", async () => {
    const listed = await storage.getProjectStorageBuckets(actor());
    expect(listed.buckets).toHaveLength(1);
    expect(listed.buckets[0]!.name).toBe("assets");
    expect(listed.buckets[0]!.usageMb).toBe(4);
    expect(listed.buckets[0]!.accessKey).toMatch(/^ak[a-z0-9]{16}$/);
  });

  it("refuses a duplicate name in the same Project", async () => {
    await expect(
      storage.createProjectStorageBucket({ ...actor(), name: "assets" }),
    ).rejects.toMatchObject({ code: "bucket_exists", status: 409 });
  });

  it("enforces the Bucket Quota at three per Project", async () => {
    await storage.createProjectStorageBucket({ ...actor(), name: "uploads" });
    await storage.createProjectStorageBucket({ ...actor(), name: "backups" });
    await expect(
      storage.createProjectStorageBucket({ ...actor(), name: "overflow" }),
    ).rejects.toMatchObject({
      code: "quota_exceeded",
      status: 409,
      details: { resource: "bucket", limit: 3, usage: 3 },
    });
  });

  it("keeps the row when the node cannot remove it, then deletes on retry", async () => {
    remove.mockRejectedValueOnce(new Error("node down"));
    await expect(
      storage.deleteProjectStorageBucket({
        ...actor(),
        bucketId: createdId,
        confirmation: "assets",
      }),
    ).rejects.toThrow();
    expect((await storage.getProjectStorageBuckets(actor())).buckets).toHaveLength(3);

    await expect(
      storage.deleteProjectStorageBucket({
        ...actor(),
        bucketId: createdId,
        confirmation: "wrong-name",
      }),
    ).rejects.toMatchObject({ code: "invalid_confirmation" });

    await storage.deleteProjectStorageBucket({
      ...actor(),
      bucketId: createdId,
      confirmation: "assets",
    });
    expect((await storage.getProjectStorageBuckets(actor())).buckets).toHaveLength(2);
  });
});
