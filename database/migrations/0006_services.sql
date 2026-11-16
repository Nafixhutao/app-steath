-- Services belong to a Project and carry everything needed to build and run
-- them later: the public repository, Dockerfile location, container port, and
-- health path. The Platform Subdomain is unique across the whole platform
-- because Caddy routes by hostname. Removing a Project removes its Services.
CREATE TABLE "service" (
  "id" text PRIMARY KEY,
  "projectId" text NOT NULL REFERENCES "project" ("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "repoUrl" text NOT NULL,
  "branch" text NOT NULL DEFAULT 'main',
  "dockerfilePath" text NOT NULL DEFAULT 'Dockerfile',
  "containerPort" integer NOT NULL DEFAULT 3000,
  "healthPath" text,
  "status" text NOT NULL DEFAULT 'not_deployed',
  "platformHostname" text NOT NULL,
  "cpuLimit" numeric(4, 2) NOT NULL DEFAULT 0.5,
  "memoryLimitMb" integer NOT NULL DEFAULT 512,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_container_port_range" CHECK ("containerPort" BETWEEN 1 AND 65535),
  CONSTRAINT "service_status_values" CHECK (
    "status" IN ('not_deployed', 'deploying', 'running', 'stopped', 'failed', 'suspended')
  )
);

CREATE UNIQUE INDEX "service_platform_hostname_key"
ON "service" ("platformHostname");

CREATE INDEX "idx_service_project_created"
ON "service" ("projectId", "createdAt");

CREATE OR REPLACE FUNCTION platform_touch_service_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_touch_service_updated_at
BEFORE UPDATE ON "service"
FOR EACH ROW EXECUTE FUNCTION platform_touch_service_updated_at();
