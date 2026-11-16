-- A Backup is one scheduled copy of a Database, a Volume, or the platform
-- PostgreSQL. The Node Agent produces the artifact; the Control Plane stores it
-- in S3-compatible storage when credentials exist and on local disk otherwise.
-- `storageProvider` is what lets the dashboard warn that a local-only Backup
-- does not survive losing the VPS.
CREATE TABLE "backup" (
  "id" text PRIMARY KEY,
  -- Platform Backups are not owned by an Organization; they are visible in the
  -- dashboard as the Control Plane's own recovery point.
  "organizationId" text REFERENCES "organization" ("id") ON DELETE CASCADE,
  "projectId" text REFERENCES "project" ("id") ON DELETE CASCADE,
  "targetType" text NOT NULL,
  "targetId" text,
  "status" text NOT NULL DEFAULT 'pending',
  "storageKey" text,
  "storageProvider" text CHECK ("storageProvider" IN ('s3', 'local')),
  "sizeBytes" bigint NOT NULL DEFAULT 0 CHECK ("sizeBytes" >= 0),
  "errorMessage" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  -- Seven days after the Backup was taken, both the object and this row are
  -- removed. Storing it per row means a changed retention rule never rewrites
  -- history.
  "expiresAt" timestamptz NOT NULL,
  CONSTRAINT "backup_target_type_values" CHECK (
    "targetType" IN ('database', 'volume', 'platform')
  ),
  CONSTRAINT "backup_status_values" CHECK (
    "status" IN ('pending', 'running', 'completed', 'failed')
  )
);

CREATE INDEX "idx_backup_organization_created"
ON "backup" ("organizationId", "createdAt" DESC);

-- The daily scheduler asks "is there already a Backup for this target today?".
CREATE INDEX "idx_backup_target_created"
ON "backup" ("targetType", "targetId", "createdAt" DESC);

-- Retention deletes by expiry.
CREATE INDEX "idx_backup_expires"
ON "backup" ("expiresAt");

CREATE OR REPLACE FUNCTION platform_touch_backup_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_touch_backup_updated_at
BEFORE UPDATE ON "backup"
FOR EACH ROW EXECUTE FUNCTION platform_touch_backup_updated_at();

-- Backups and other scheduled work are performed by the platform itself, not by
-- a signed-in user. A system AuditEvent therefore has no actor; the action and
-- details still identify what happened.
ALTER TABLE "audit_event" ALTER COLUMN "actorUserId" DROP NOT NULL;
