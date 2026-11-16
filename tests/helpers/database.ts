import { Client } from "pg";
import { runMigrations } from "@/lib/platform/migrations";

const DEFAULT_TEST_DATABASE_URL =
  "postgresql://stealth:stealth_dev_password@localhost:5432/stealth_hosting_test";

function getTestDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid database name: ${value}`);
  }

  return `"${value.replace(/"/g, '""')}"`;
}

export async function ensureTestDatabase(): Promise<string> {
  const targetUrl = new URL(getTestDatabaseUrl());
  const databaseName = decodeURIComponent(targetUrl.pathname.replace(/^\//, ""));

  if (!databaseName) {
    throw new Error("TEST_DATABASE_URL must include a database name");
  }

  const adminUrl = new URL(targetUrl.toString());
  adminUrl.pathname = "/postgres";

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();

  try {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      databaseName,
    ]);

    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    }
  } finally {
    await client.end();
  }

  return targetUrl.toString();
}

/**
 * Creates the test database, applies pending migrations, and points
 * `DATABASE_URL` at it. Call this from `beforeAll` in every test file that
 * touches the platform database.
 */
export async function prepareTestDatabase(): Promise<string> {
  const databaseUrl = await ensureTestDatabase();
  process.env.DATABASE_URL = databaseUrl;
  await runMigrations(databaseUrl);

  return databaseUrl;
}
