import { beforeAll, describe, expect, it } from "vitest";
import { prepareTestDatabase } from "../helpers/database";

let readableDatabaseRole: (typeof import("@/lib/platform/databases"))["readableDatabaseRole"];
let readableRoleSuffix: (typeof import("@/lib/platform/databases"))["readableRoleSuffix"];
let databaseObjectNames: (typeof import("@/lib/platform/databases"))["databaseObjectNames"];

async function queryRows<T extends Record<string, unknown>>(
  query: string,
  values: unknown[],
): Promise<T[]> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query<T>(query, values);
    return result.rows;
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await prepareTestDatabase();
  ({ readableDatabaseRole, readableRoleSuffix, databaseObjectNames } =
    await import("@/lib/platform/databases"));
});

/**
 * The readable role is what makes phpMyAdmin usable without the connection
 * string, so its shape is a product guarantee rather than an implementation
 * detail: a person has to be able to read it and type it.
 */
describe("readableDatabaseRole", () => {
  it("builds `{project}_{6 chars}` from the Project name", () => {
    expect(readableDatabaseRole("Apap", "a1b2c3")).toBe("apap_a1b2c3");
  });

  it("folds spaces and punctuation into underscores and drops accents", () => {
    expect(readableDatabaseRole("Toko Online — Cabang 2", "z9y8x7")).toBe(
      "toko_online_cabang_2_z9y8x7",
    );
  });

  it("stays within MySQL's 32-character user name limit", () => {
    const long = "a".repeat(80);
    const role = readableDatabaseRole(long, "abcdef");

    expect(role.length).toBeLessThanOrEqual(32);
    expect(role).toMatch(/^[a-z0-9_]{1,26}_[a-z0-9]{6}$/);
  });

  it("falls back to `db` when a Project name has no usable characters", () => {
    expect(readableDatabaseRole("★★★", "abc123")).toBe("db_abc123");
  });

  it("produces a six-character lowercase suffix", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(readableRoleSuffix()).toMatch(/^[a-z0-9]{6}$/);
    }
  });
});

describe("databaseObjectNames", () => {
  it("keeps the legacy derived schema so an existing Database still resolves", () => {
    const names = databaseObjectNames("37f155cd-2610-43cf-a4ff-c4100000ab12");

    // The schema is unchanged on purpose: it is derived from the id and is never
    // shown, so renaming it would orphan the data already inside it.
    expect(names.schema).toBe("db_37f155cd261043cfa4ffc410");
    expect(names.role).toBe("u_37f155cd261043cfa4ffc410");
  });
});

describe("database username uniqueness", () => {
  it("enforces the `database_username_key` unique index the insert maps to a 503", async () => {
    await queryRows(
      `INSERT INTO "organization" ("id", "name", "slug", "createdAt")
       VALUES ('org-dupdb', 'Dup DB Org', 'dup-db-org', now())
       ON CONFLICT ("id") DO NOTHING`,
      [],
    );
    await queryRows(
      `INSERT INTO "project" ("id", "organizationId", "name", "slug")
       VALUES ('prj-dupdb-1', 'org-dupdb', 'Dup DB Project 1', 'dup-db-project-1'),
              ('prj-dupdb-2', 'org-dupdb', 'Dup DB Project 2', 'dup-db-project-2')
       ON CONFLICT ("id") DO NOTHING`,
      [],
    );

    const username = `dup_${readableRoleSuffix()}`;
    // Two Databases in two Projects share one username: only the
    // `database_username_key` index can reject the second, because the
    // one-Database-per-Project rule is satisfied on each side.
    await queryRows(
      `INSERT INTO "database" ("id", "projectId", "engine", "version", "databaseName",
         "username", "encryptedPassword", "storageLimitMb")
       VALUES ($1, 'prj-dupdb-1', 'postgres', '16', 'app', $2, 'v1.test', 1024)`,
      [`dupdb-first-${username}`, username],
    );

    // A second insert with the same username must fail with the exact
    // constraint name `createProjectDatabase` maps to a retryable 503, so the
    // index name and the runtime check can never drift apart silently.
    await expect(
      queryRows(
        `INSERT INTO "database" ("id", "projectId", "engine", "version", "databaseName",
           "username", "encryptedPassword", "storageLimitMb")
         VALUES ($1, 'prj-dupdb-2', 'postgres', '16', 'app', $2, 'v1.test', 1024)`,
        [`dupdb-second-${username}`, username],
      ),
    ).rejects.toMatchObject({ constraint: "database_username_key" });

    await queryRows('DELETE FROM "database" WHERE "id" LIKE $1', [`dupdb-%`]);
    await queryRows('DELETE FROM "project" WHERE "id" LIKE $1', ["prj-dupdb-%"]);
    await queryRows('DELETE FROM "organization" WHERE "id" = $1', ["org-dupdb"]);
  });
});
