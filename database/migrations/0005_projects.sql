-- Projects group Services and a Database inside an Organization. The slug is
-- unique per Organization, and the API enforces the three-Project Quota.
-- Services and Databases added in later migrations reference this table with
-- ON DELETE CASCADE so removing a Project cleans up its resources.
CREATE TABLE "project" (
  "id" text PRIMARY KEY,
  "organizationId" text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "project_organization_id_slug_key"
ON "project" ("organizationId", "slug");

CREATE INDEX "idx_project_organization_created"
ON "project" ("organizationId", "createdAt");

CREATE OR REPLACE FUNCTION platform_touch_project_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_touch_project_updated_at
BEFORE UPDATE ON "project"
FOR EACH ROW EXECUTE FUNCTION platform_touch_project_updated_at();
