CREATE TABLE "audit_event" (
  "id" bigserial PRIMARY KEY,
  "organizationId" text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "actorUserId" text NOT NULL REFERENCES "user" ("id") ON DELETE RESTRICT,
  "targetUserId" text REFERENCES "user" ("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_audit_event_organization_created"
ON "audit_event" ("organizationId", "createdAt" DESC);

CREATE OR REPLACE FUNCTION platform_prevent_last_owner_removal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_count integer;
BEGIN
  IF current_setting('platform.allow_owner_removal', true) = 'true' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF 'owner' = ANY(string_to_array(OLD."role", ',')) AND (
    TG_OP = 'DELETE' OR NOT ('owner' = ANY(string_to_array(NEW."role", ',')))
  ) THEN
    PERFORM pg_advisory_xact_lock(hashtext(OLD."organizationId"));
    SELECT count(*) INTO owner_count
    FROM "member"
    WHERE "organizationId" = OLD."organizationId"
      AND 'owner' = ANY(string_to_array("role", ','));

    IF owner_count <= 1 THEN
      RAISE EXCEPTION 'The last Organization owner cannot be removed or demoted'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER platform_prevent_last_owner_removal
BEFORE UPDATE OF "role" OR DELETE ON "member"
FOR EACH ROW EXECUTE FUNCTION platform_prevent_last_owner_removal();
