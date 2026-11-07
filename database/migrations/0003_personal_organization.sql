-- A personal Organization is created in the same transaction as the User row,
-- so signup can never leave a User without an owner membership.
CREATE OR REPLACE FUNCTION platform_create_personal_organization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  base_slug text;
  organization_id text;
BEGIN
  base_slug := lower(coalesce(nullif(NEW."username", ''), split_part(NEW."email", '@', 1)));
  base_slug := regexp_replace(base_slug, '[^a-z0-9]+', '-', 'g');
  base_slug := btrim(base_slug, '-');

  IF base_slug = '' THEN
    base_slug := 'workspace';
  END IF;

  organization_id := gen_random_uuid()::text;

  INSERT INTO "organization" ("id", "name", "slug", "createdAt")
  VALUES (
    organization_id,
    NEW."name" || ' Organization',
    base_slug || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8),
    now()
  );

  INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
  VALUES (gen_random_uuid()::text, organization_id, NEW."id", 'owner', now());

  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_create_personal_organization
AFTER INSERT ON "user"
FOR EACH ROW EXECUTE FUNCTION platform_create_personal_organization();

-- The first Organization a User owns becomes the active Organization as soon
-- as the signup session is created.
CREATE OR REPLACE FUNCTION platform_set_active_organization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."activeOrganizationId" IS NULL THEN
    SELECT "organizationId"
    INTO NEW."activeOrganizationId"
    FROM "member"
    WHERE "userId" = NEW."userId"
    ORDER BY "createdAt" ASC
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_set_active_organization
BEFORE INSERT ON "session"
FOR EACH ROW EXECUTE FUNCTION platform_set_active_organization();

CREATE UNIQUE INDEX member_organization_id_user_id_key
ON "member" ("organizationId", "userId");
