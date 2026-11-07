import { runMigrations } from "../lib/platform/migrations.ts";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

await runMigrations(connectionString);
console.log("Platform migrations applied");
