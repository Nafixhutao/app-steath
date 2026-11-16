-- Usage snapshots power the Organization Quota dashboard. One row records the
-- measured CPU, memory, Volume, and Database storage of one resource at a point
-- in time, so the dashboard can show the latest measurement without asking the
-- node on every request.
CREATE TABLE "usage_snapshot" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "projectId" text REFERENCES "project"("id") ON DELETE CASCADE,
  "serviceId" text REFERENCES "service"("id") ON DELETE CASCADE,
  "databaseId" text REFERENCES "database"("id") ON DELETE CASCADE,
  "cpuUsage" numeric(8, 4) NOT NULL DEFAULT 0,
  "memoryUsageMb" integer NOT NULL DEFAULT 0,
  "volumeUsageMb" integer NOT NULL DEFAULT 0,
  "databaseUsageMb" integer NOT NULL DEFAULT 0,
  "capturedAt" timestamp with time zone NOT NULL DEFAULT now()
);

-- The dashboard reads the newest batch for one Organization; the retention pass
-- deletes by age.
CREATE INDEX "idx_usage_snapshot_organization_captured"
  ON "usage_snapshot" ("organizationId", "capturedAt" DESC);
CREATE INDEX "idx_usage_snapshot_service_captured"
  ON "usage_snapshot" ("serviceId", "capturedAt" DESC);
CREATE INDEX "idx_usage_snapshot_database_captured"
  ON "usage_snapshot" ("databaseId", "capturedAt" DESC);
