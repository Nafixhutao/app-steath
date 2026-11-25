-- An S3-compatible Bucket is a tenant's object storage inside the one shared
-- MinIO server on the node. Like ADR-0012's Databases, the server is shared and
-- isolation lives inside it: every Bucket gets its own physical name, quota,
-- IAM user and policy. The Control Plane owns the row (and the sealed secret);
-- the Node Agent owns the objects and the policy inside MinIO.
CREATE TABLE "storage_bucket" (
  "id" text PRIMARY KEY,
  "projectId" text NOT NULL REFERENCES "project" ("id") ON DELETE CASCADE,
  -- The name the user picked and sees. Unique per Project, so two Projects may
  -- both have a bucket called "assets" without colliding.
  "name" text NOT NULL,
  -- Physical MinIO bucket, derived from the id. MinIO's namespace is node-wide,
  -- so it cannot be the user-facing name. Keeping it in the row means a rename
  -- never moves the objects.
  "objectName" text NOT NULL UNIQUE,
  "accessKey" text NOT NULL UNIQUE,
  "encryptedSecretKey" text NOT NULL,
  "public" boolean NOT NULL DEFAULT false,
  -- Enforced by MinIO's bucket quota, not by counting bytes in the dashboard.
  "quotaMb" integer NOT NULL DEFAULT 1024 CHECK ("quotaMb" > 0 AND "quotaMb" <= 1024),
  "status" text NOT NULL DEFAULT 'provisioning'
    CHECK ("status" IN ('provisioning', 'ready', 'failed')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "storage_bucket_project_name_key" UNIQUE ("projectId", "name")
);

CREATE INDEX "storage_bucket_project_id_idx" ON "storage_bucket" ("projectId");

CREATE OR REPLACE FUNCTION platform_touch_storage_bucket_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_touch_storage_bucket_updated_at
BEFORE UPDATE ON "storage_bucket"
FOR EACH ROW EXECUTE FUNCTION platform_touch_storage_bucket_updated_at();
