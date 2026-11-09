-- A Custom Domain is the one optional hostname a Service may serve in addition
-- to its Platform Subdomain. It starts pending: the owner proves control with a
-- TXT record and points DNS at the platform before the Control Plane marks it
-- active and Caddy may issue a certificate for it. The unique constraints make
-- both promises structural: one domain per Service and no hostname shared by two
-- Services.
CREATE TABLE "custom_domain" (
  "id" text PRIMARY KEY,
  "serviceId" text NOT NULL UNIQUE REFERENCES "service" ("id") ON DELETE CASCADE,
  "hostname" text NOT NULL UNIQUE,
  "status" text NOT NULL DEFAULT 'pending'
    CHECK ("status" IN ('pending', 'active', 'failed')),
  -- The value the owner publishes at `_stealth-verify.<hostname>`. It is not a
  -- secret; it proves control of the name.
  "verificationToken" text NOT NULL,
  -- Caddy issues the certificate on demand, gated by the Control Plane's `ask`
  -- endpoint. `pending` means the hostname is not allowed yet, `issued` means it
  -- is active and may be served, `failed` keeps the last verification error.
  "certificateStatus" text NOT NULL DEFAULT 'pending'
    CHECK ("certificateStatus" IN ('pending', 'issued', 'failed')),
  "verifiedAt" timestamptz,
  "lastError" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_custom_domain_status" ON "custom_domain" ("status");

CREATE OR REPLACE FUNCTION platform_touch_custom_domain_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_touch_custom_domain_updated_at
BEFORE UPDATE ON "custom_domain"
FOR EACH ROW EXECUTE FUNCTION platform_touch_custom_domain_updated_at();
