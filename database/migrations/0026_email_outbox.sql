-- Transactional email in one place. Credentials live in one row per provider,
-- sealed with the platform key; every send is recorded in an outbox so the
-- worker can retry it and a provider switch cannot send the same message twice.
CREATE TABLE "email_provider" (
  "provider" text PRIMARY KEY CHECK ("provider" IN ('resend', 'mailjet')),
  "enabled" boolean NOT NULL DEFAULT false,
  -- Lower priority is tried first: 1 = primary, 2 = fallback.
  "priority" integer NOT NULL DEFAULT 1 CHECK ("priority" BETWEEN 1 AND 9),
  -- Resend needs one API key; Mailjet needs the public key and the private
  -- secret. Both are encrypted at rest and never returned by the API.
  "apiKeyEncrypted" text,
  "apiSecretEncrypted" text,
  "fromEmail" text NOT NULL DEFAULT '',
  "fromName" text NOT NULL DEFAULT 'Stealth',
  -- Free-tier ceilings. The worker counts sends locally so it can switch to
  -- the fallback before a provider answers 429.
  "monthlyLimit" integer NOT NULL DEFAULT 3000 CHECK ("monthlyLimit" > 0),
  "dailyLimit" integer NOT NULL DEFAULT 100 CHECK ("dailyLimit" > 0),
  "usedMonth" integer NOT NULL DEFAULT 0,
  "usedDay" integer NOT NULL DEFAULT 0,
  "quotaMonth" text NOT NULL DEFAULT '',
  "quotaDay" text NOT NULL DEFAULT '',
  "lastError" text,
  "lastTestedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "email_provider" ("provider", "priority", "monthlyLimit", "dailyLimit")
VALUES ('resend', 1, 3000, 100), ('mailjet', 2, 6000, 200);

CREATE OR REPLACE FUNCTION platform_touch_email_provider_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_touch_email_provider_updated_at
BEFORE UPDATE ON "email_provider"
FOR EACH ROW EXECUTE FUNCTION platform_touch_email_provider_updated_at();

CREATE TABLE "email_outbox" (
  "id" text PRIMARY KEY,
  "toEmail" text NOT NULL,
  "subject" text NOT NULL,
  "html" text NOT NULL,
  "text" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'queued'
    CHECK ("status" IN ('queued', 'sending', 'sent', 'failed')),
  -- The row id doubles as the Resend Idempotency-Key and the Mailjet CustomID.
  "provider" text CHECK ("provider" IN ('resend', 'mailjet')),
  "providerMessageId" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "nextAttemptAt" timestamptz NOT NULL DEFAULT now(),
  "lastError" text,
  "sentAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "email_outbox_claim_idx" ON "email_outbox" ("status", "nextAttemptAt", "createdAt");
CREATE INDEX "email_outbox_recent_idx" ON "email_outbox" ("createdAt" DESC);

CREATE OR REPLACE FUNCTION platform_touch_email_outbox_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_touch_email_outbox_updated_at
BEFORE UPDATE ON "email_outbox"
FOR EACH ROW EXECUTE FUNCTION platform_touch_email_outbox_updated_at();
