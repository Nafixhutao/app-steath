-- A Database Proxy is the opt-in public endpoint for one Database. It is absent
-- by default, so a newly created Database has no public port. When an owner or
-- admin enables it, the Node Agent publishes a unique port in the 20000-29999
-- range and only the listed source CIDRs may connect. Deleting the Database
-- cascades this row away with the endpoint.
CREATE TABLE "database_proxy" (
  "databaseId" text PRIMARY KEY REFERENCES "database" ("id") ON DELETE CASCADE,
  -- The public port is unique across the node. The Node Agent also checks the
  -- host before binding, but this constraint keeps the Control Plane's view
  -- consistent when two enables race.
  "port" integer NOT NULL UNIQUE CHECK ("port" >= 20000 AND "port" <= 29999),
  -- At least one CIDR is required: a public Database must never be open to
  -- everyone by accident. The Node Agent normalizes bare addresses to /32 or
  -- /128 and rejects anything that could break its generated configuration.
  "allowlist" text[] NOT NULL CHECK (cardinality("allowlist") > 0),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION platform_touch_database_proxy_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_touch_database_proxy_updated_at
BEFORE UPDATE ON "database_proxy"
FOR EACH ROW EXECUTE FUNCTION platform_touch_database_proxy_updated_at();
