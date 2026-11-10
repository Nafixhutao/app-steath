CREATE TABLE "abuse_report" (
  "id" text PRIMARY KEY,
  "targetUrl" text NOT NULL,
  "category" text NOT NULL,
  "description" text NOT NULL,
  "reporterEmail" text,
  "status" text NOT NULL DEFAULT 'new',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "abuse_report_category_values" CHECK ("category" IN ('malware', 'phishing', 'spam', 'copyright', 'other')),
  CONSTRAINT "abuse_report_status_values" CHECK ("status" IN ('new', 'triaged', 'resolved', 'dismissed'))
);
CREATE INDEX "idx_abuse_report_status_created" ON "abuse_report" ("status", "createdAt" DESC);

CREATE TABLE "abuse_report_rate_limit" (
  "ipHash" text NOT NULL,
  "windowStartedAt" timestamptz NOT NULL,
  "count" integer NOT NULL,
  PRIMARY KEY ("ipHash", "windowStartedAt")
);

ALTER TABLE "audit_event" ALTER COLUMN "organizationId" DROP NOT NULL;
ALTER TABLE "audit_event" ALTER COLUMN "actorUserId" DROP NOT NULL;
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_platform_actor_required"
  CHECK ("organizationId" IS NOT NULL OR ("actorUserId" IS NOT NULL AND "action" LIKE 'platform.%'));

ALTER TABLE "service" ADD COLUMN "suspendedFromStatus" text;
ALTER TABLE "organization" ADD COLUMN "suspendedAt" timestamptz;
ALTER TABLE "service" ADD CONSTRAINT "service_suspended_from_status_values"
  CHECK ("suspendedFromStatus" IS NULL OR "suspendedFromStatus" IN ('running', 'stopped', 'not_deployed', 'failed', 'deploying'));
