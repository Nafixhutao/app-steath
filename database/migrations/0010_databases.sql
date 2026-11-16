-- A Database is the one PostgreSQL instance a Project can have. The Node Agent
-- runs it as a container on the Project network with its own Volume, so Services
-- in the same Project reach it at the `db` alias and nothing outside the network
-- can connect. This row is the Control Plane's record of the credentials and the
-- storage limit; the password is sealed with the platform encryption key.
CREATE TABLE "database" (
  "id" text PRIMARY KEY,
  -- One Database per Project, enforced by the unique constraint rather than by
  -- application code so two concurrent creates cannot both win.
  "projectId" text NOT NULL UNIQUE REFERENCES "project" ("id") ON DELETE CASCADE,
  "engine" text NOT NULL DEFAULT 'postgres' CHECK ("engine" = 'postgres'),
  "version" text NOT NULL DEFAULT '16' CHECK ("version" = '16'),
  "databaseName" text NOT NULL DEFAULT 'app',
  "username" text NOT NULL DEFAULT 'app',
  -- AES-256-GCM ciphertext. The plaintext password only leaves the Control
  -- Plane through an explicit connection-string read or a Deployment body.
  "encryptedPassword" text NOT NULL,
  -- The platform caps a Database at 1 GB. The Node Agent measures the Volume and
  -- stops the container when it grows past the limit, because Docker's local
  -- driver has no per-Volume quota.
  "storageLimitMb" integer NOT NULL DEFAULT 1024
    CHECK ("storageLimitMb" > 0 AND "storageLimitMb" <= 1024),
  "status" text NOT NULL DEFAULT 'provisioning'
    CHECK ("status" IN ('provisioning', 'running', 'stopped', 'failed')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION platform_touch_database_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_touch_database_updated_at
BEFORE UPDATE ON "database"
FOR EACH ROW EXECUTE FUNCTION platform_touch_database_updated_at();
