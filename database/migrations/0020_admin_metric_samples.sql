-- Admin control-plane metric samples, ported from the stealth-forge admin
-- console. The Overview page polls in-process host, database, and Redis
-- samples every 5 seconds; the worker records each sample here so the history
-- survives process restarts (Forge keeps a 720-sample ring in memory).
CREATE TABLE "admin_db_metric" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "connections" integer NOT NULL,
  "maxConnections" integer NOT NULL,
  "activeQueries" integer NOT NULL,
  "cacheHitRatioKnown" boolean NOT NULL,
  "cacheHitRatioPercent" numeric(5, 2) NOT NULL,
  "transactionsPerSec" numeric(10, 2) NOT NULL,
  "queryLatencyMs" numeric(10, 2) NOT NULL,
  "replicationStandbys" integer NOT NULL DEFAULT 0,
  "databaseSizeBytes" bigint NOT NULL,
  "uptimeSeconds" numeric(12, 2) NOT NULL,
  "capturedAt" timestamp with time zone NOT NULL DEFAULT now()
);

-- The Overview reads the history inside a time window; the retention pass
-- deletes by age.
CREATE INDEX "idx_admin_db_metric_captured"
  ON "admin_db_metric" ("capturedAt" DESC);

CREATE TABLE "admin_redis_metric" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "connections" integer NOT NULL,
  "maxClients" integer NOT NULL,
  "opsPerSec" numeric(12, 2) NOT NULL,
  "hitRateKnown" boolean NOT NULL,
  "hitRatePercent" numeric(5, 2) NOT NULL,
  "memoryUsedBytes" bigint NOT NULL,
  "memoryMaxBytes" bigint NOT NULL,
  "keys" bigint NOT NULL,
  "uptimeSeconds" numeric(12, 2) NOT NULL,
  "capturedAt" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "idx_admin_redis_metric_captured"
  ON "admin_redis_metric" ("capturedAt" DESC);

-- The incidents board is the one Forge surface that needed a new backend:
-- paas had no incident store, so these tables back the ported Incidents page
-- and the public Status Page. Shapes mirror the Forge AdminIncident wire type.
CREATE TABLE "admin_incident" (
  "id" text PRIMARY KEY,
  "title" text NOT NULL,
  "severity" text NOT NULL CHECK ("severity" IN ('info', 'warning', 'critical')),
  "status" text NOT NULL CHECK ("status" IN ('investigating', 'identified', 'monitoring', 'resolved')),
  "services" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "startedAt" timestamp with time zone NOT NULL,
  "resolvedAt" timestamp with time zone,
  "createdByAccountId" text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "idx_admin_incident_started"
  ON "admin_incident" ("startedAt" DESC);

CREATE TABLE "admin_incident_event" (
  "id" text PRIMARY KEY,
  "incidentId" text NOT NULL REFERENCES "admin_incident"("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('alert', 'deployment', 'restart', 'backup', 'configuration', 'monitor', 'note')),
  "message" text NOT NULL,
  "actorAccountId" text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "idx_admin_incident_event_incident"
  ON "admin_incident_event" ("incidentId", "createdAt");
