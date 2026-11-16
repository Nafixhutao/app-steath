import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

export const MIGRATIONS_TABLE = "platform_schema_migrations";

const MIGRATIONS_DIR = path.join(process.cwd(), "database", "migrations");
const MIGRATION_LOCK_ID = "stealth-platform-migrations";

export async function runMigrations(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();

    for (const file of files) {
      const applied = await client.query(`SELECT 1 FROM ${MIGRATIONS_TABLE} WHERE id = $1`, [file]);

      if (applied.rowCount) {
        continue;
      }

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");

      try {
        await client.query(sql);
        await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (id) VALUES ($1)`, [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_ID])
      .catch(() => undefined);
    await client.end();
  }
}
