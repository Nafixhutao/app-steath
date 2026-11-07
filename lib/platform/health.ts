import { Client } from "pg";
import { MIGRATIONS_TABLE } from "@/lib/platform/migrations";

export type PlatformHealth = {
  status: "ok" | "error";
  database: "ok" | "unavailable";
  migrations: "ok" | "missing" | "unknown";
};

export type PlatformHealthResult = {
  statusCode: number;
  body: PlatformHealth;
};

const unavailable: PlatformHealthResult = {
  statusCode: 503,
  body: { status: "error", database: "unavailable", migrations: "unknown" },
};

const migrationsMissing: PlatformHealthResult = {
  statusCode: 503,
  body: { status: "error", database: "ok", migrations: "missing" },
};

export async function checkPlatformHealth(
  connectionString = process.env.DATABASE_URL,
): Promise<PlatformHealthResult> {
  if (!connectionString) {
    return unavailable;
  }

  const client = new Client({ connectionString });

  try {
    try {
      await client.connect();
      await client.query("SELECT 1");
    } catch {
      return unavailable;
    }

    try {
      const result = await client.query<{
        has_table: boolean;
        has_extension: boolean;
      }>(`
        SELECT
          to_regclass('public.${MIGRATIONS_TABLE}') IS NOT NULL AS has_table,
          EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') AS has_extension
      `);

      if (!result.rows[0]?.has_table || !result.rows[0].has_extension) {
        return migrationsMissing;
      }

      const migrations = await client.query<{ has_migrations: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM ${MIGRATIONS_TABLE}) AS has_migrations`,
      );

      if (!migrations.rows[0]?.has_migrations) {
        return migrationsMissing;
      }

      return {
        statusCode: 200,
        body: { status: "ok", database: "ok", migrations: "ok" },
      };
    } catch {
      return migrationsMissing;
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}
