-- A Restore is one request to put a Database or Volume back to a Backup. The
-- Node Agent performs the data work; the Control Plane stops the affected
-- Services, drives the restore, and starts them again. The row is kept after the
-- Backup expires so the history of what was restored, and whether it worked,
-- survives the seven-day retention window.
CREATE TABLE "restore" (
  "id" text PRIMARY KEY,
  "organizationId" text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "projectId" text REFERENCES "project" ("id") ON DELETE CASCADE,
  -- The Backup may be pruned while the history stays, so the reference is
  -- nullable. A restore is never possible without a completed Backup anyway.
  "backupId" text REFERENCES "backup" ("id") ON DELETE SET NULL,
  "targetType" text NOT NULL,
  -- Database id or Docker Volume name, exactly as the Backup recorded it.
  "targetId" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "errorMessage" text,
  "createdBy" text REFERENCES "user" ("id") ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "startedAt" timestamptz,
  "finishedAt" timestamptz,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "restore_target_type_values" CHECK (
    "targetType" IN ('database', 'volume')
  ),
  CONSTRAINT "restore_status_values" CHECK (
    "status" IN ('pending', 'running', 'completed', 'failed')
  )
);

CREATE INDEX "idx_restore_organization_created"
ON "restore" ("organizationId", "createdAt" DESC);

-- One target can only have one Restore in flight. Two concurrent requests would
-- otherwise stop and restart the same Services twice.
CREATE UNIQUE INDEX "idx_restore_active_target"
ON "restore" ("organizationId", "targetType", "targetId")
WHERE "status" IN ('pending', 'running');

CREATE OR REPLACE FUNCTION platform_touch_restore_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_touch_restore_updated_at
BEFORE UPDATE ON "restore"
FOR EACH ROW EXECUTE FUNCTION platform_touch_restore_updated_at();
