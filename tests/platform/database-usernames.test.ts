import { beforeAll, describe, expect, it } from "vitest";
import { prepareTestDatabase } from "../helpers/database";

let readableDatabaseRole: (typeof import("@/lib/platform/databases"))["readableDatabaseRole"];
let readableRoleSuffix: (typeof import("@/lib/platform/databases"))["readableRoleSuffix"];
let databaseObjectNames: (typeof import("@/lib/platform/databases"))["databaseObjectNames"];

beforeAll(async () => {
  await prepareTestDatabase();
  ({ readableDatabaseRole, readableRoleSuffix, databaseObjectNames } = await import(
    "@/lib/platform/databases"
  ));
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
