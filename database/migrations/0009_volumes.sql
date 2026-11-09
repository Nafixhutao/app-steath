-- A Volume is the one persistent directory a Service can keep across restarts
-- and redeploys. The Docker Volume itself is created and labelled by the Node
-- Agent; this row is the Control Plane's record of the mount path and size the
-- Service asked for. Removing a Service removes its Volume row, and the agent
-- removes the Docker Volume with the container.
CREATE TABLE "volume" (
  "id" text PRIMARY KEY,
  -- One Volume per Service, enforced by the unique constraint rather than by
  -- application code so two concurrent creates cannot both win.
  "serviceId" text NOT NULL UNIQUE REFERENCES "service" ("id") ON DELETE CASCADE,
  -- Deterministic Docker Volume name, derived from the Service id. Keeping it
  -- in the row means a rename of the Service never moves the data.
  "dockerVolumeName" text NOT NULL UNIQUE,
  "mountPath" text NOT NULL,
  -- The platform caps a Service Volume at 1 GB. The Node Agent enforces the
  -- limit, because Docker's local driver has no per-Volume quota.
  "sizeMb" integer NOT NULL DEFAULT 1024 CHECK ("sizeMb" > 0 AND "sizeMb" <= 1024),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION platform_touch_volume_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_touch_volume_updated_at
BEFORE UPDATE ON "volume"
FOR EACH ROW EXECUTE FUNCTION platform_touch_volume_updated_at();
