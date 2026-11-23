-- A Database is now either PostgreSQL or MySQL. The engine is fixed at
-- provisioning: the data directory layout, the readiness probe, the password
-- rotation statement, and the dump tool all differ, so an existing Database is
-- never converted in place. Deleting and provisioning again is the only way to
-- change it, which is why the choice is explicit in the dashboard.
ALTER TABLE "database" DROP CONSTRAINT "database_engine_check";
ALTER TABLE "database" DROP CONSTRAINT "database_version_check";

ALTER TABLE "database"
  ADD CONSTRAINT "database_engine_check" CHECK ("engine" IN ('postgres', 'mysql')),
  ADD CONSTRAINT "database_version_check" CHECK (
    ("engine" = 'postgres' AND "version" = '16') OR
    ("engine" = 'mysql' AND "version" = '8')
  );

-- A MySQL Database always ships with phpMyAdmin, a browser client routed on the
-- Platform Domain. The hostname is allocated once so the link in the dashboard
-- keeps working across redeploys and agent restarts; PostgreSQL Databases have
-- none, so the column is nullable.
ALTER TABLE "database" ADD COLUMN "phpMyAdminHostname" text;

-- Two Databases must never answer the same hostname.
CREATE UNIQUE INDEX "database_phpMyAdminHostname_key"
  ON "database" ("phpMyAdminHostname")
  WHERE "phpMyAdminHostname" IS NOT NULL;
