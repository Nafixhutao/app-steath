-- A Deployment records one attempt to build and run a Service. Build happens
-- before runtime, so this migration only needs the Build half: the commit that
-- was built, the image reference it produced, and the log that was streamed
-- back. Removing a Service removes its Deployments.
CREATE TABLE "deployment" (
  "id" text PRIMARY KEY,
  "serviceId" text NOT NULL REFERENCES "service" ("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'queued',
  "commitSha" text,
  "imageRef" text,
  "buildLogKey" text,
  "runtimeLogKey" text,
  "errorMessage" text,
  "createdBy" text REFERENCES "user" ("id") ON DELETE SET NULL,
  "startedAt" timestamptz,
  "finishedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "deployment_status_values" CHECK (
    "status" IN ('queued', 'building', 'deploying', 'running', 'failed', 'cancelled')
  )
);

CREATE INDEX "idx_deployment_service_created"
ON "deployment" ("serviceId", "createdAt" DESC);

-- Only one Deployment per Service may be in flight. The API also checks this,
-- but the index makes a concurrent double trigger impossible.
CREATE UNIQUE INDEX "deployment_one_active_per_service"
ON "deployment" ("serviceId")
WHERE "status" IN ('queued', 'building', 'deploying');

-- Build log lines are streamed from the Node Agent and kept here so the
-- dashboard can read them without the Node Agent being online. Retention is
-- enforced by the cleanup in later tickets.
CREATE TABLE "build_log" (
  "deploymentId" text NOT NULL REFERENCES "deployment" ("id") ON DELETE CASCADE,
  "sequence" integer NOT NULL,
  "message" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("deploymentId", "sequence")
);

-- A Job is a unit of work claimed by the worker. `FOR UPDATE SKIP LOCKED` on
-- the queue index keeps two workers from taking the same row.
CREATE TABLE "job" (
  "id" text PRIMARY KEY,
  "type" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'queued',
  "attempts" integer NOT NULL DEFAULT 0,
  "runAt" timestamptz NOT NULL DEFAULT now(),
  "lockedAt" timestamptz,
  "lastError" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "job_status_values" CHECK (
    "status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  )
);

CREATE INDEX "idx_job_claimable"
ON "job" ("runAt")
WHERE "status" = 'queued';

CREATE OR REPLACE FUNCTION platform_touch_job_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_touch_job_updated_at
BEFORE UPDATE ON "job"
FOR EACH ROW EXECUTE FUNCTION platform_touch_job_updated_at();

-- The Node row is the Control Plane's view of the single Node Agent. The agent
-- refreshes `lastSeenAt` with every heartbeat and the platform treats a stale
-- timestamp as an unhealthy node, which blocks new Deployments.
CREATE TABLE "node" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "baseUrl" text NOT NULL,
  "tokenHash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'unknown',
  "lastSeenAt" timestamptz,
  "capacity" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "node_status_values" CHECK ("status" IN ('unknown', 'healthy', 'unhealthy'))
);

CREATE UNIQUE INDEX "node_name_key" ON "node" ("name");
