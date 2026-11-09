-- Environment Variables are the Service's secrets: API keys, tokens, feature
-- flags. The values are encrypted before they reach the database, so a stolen
-- database dump alone never reveals a customer credential. Removing a Service
-- removes its variables, so nothing outlives the Service it belongs to.
CREATE TABLE "environment_variable" (
  "id" text PRIMARY KEY,
  "serviceId" text NOT NULL REFERENCES "service" ("id") ON DELETE CASCADE,
  "key" text NOT NULL,
  -- AES-256-GCM sealed value: `v1.<iv>.<tag>.<ciphertext>`, all base64. The
  -- Control Plane only ever reads this column to decrypt on demand; it is never
  -- written to a log or an AuditEvent.
  "valueCiphertext" text NOT NULL,
  "createdBy" text REFERENCES "user" ("id") ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- A key is unique per Service: two variables cannot answer for the same name,
-- which is what makes "the value the next Deployment uses" unambiguous.
CREATE UNIQUE INDEX "environment_variable_service_key"
ON "environment_variable" ("serviceId", "key");

CREATE OR REPLACE FUNCTION platform_touch_environment_variable_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_touch_environment_variable_updated_at
BEFORE UPDATE ON "environment_variable"
FOR EACH ROW EXECUTE FUNCTION platform_touch_environment_variable_updated_at();

-- A Service's environment carries a revision that every mutation bumps. The
-- Deployment that is serving records the revision it was started with, so a
-- Service whose revision is newer than the serving Deployment's has changes
-- that are not live yet: it needs a redeploy.
ALTER TABLE "service" ADD COLUMN "envRevision" integer NOT NULL DEFAULT 0;
ALTER TABLE "deployment" ADD COLUMN "envRevision" integer NOT NULL DEFAULT 0;
