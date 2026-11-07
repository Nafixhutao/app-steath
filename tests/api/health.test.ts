import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import { prepareTestDatabase } from "../helpers/database";

let originalDatabaseUrl: string | undefined;

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  await prepareTestDatabase();
});

afterAll(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
    return;
  }

  process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("GET /api/health", () => {
  it("reports the platform database and migrations as ready", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      database: "ok",
      migrations: "ok",
    });
  });

  it("returns 503 when the platform database is unavailable", async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://invalid:invalid@127.0.0.1:1/does_not_exist";

    try {
      const response = await GET();

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        status: "error",
        database: "unavailable",
        migrations: "unknown",
      });
    } finally {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });
});
