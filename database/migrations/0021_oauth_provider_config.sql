-- External sign-in provider credentials the Platform Admin stores in the
-- Settings panel. The client secret is encrypted at rest with the same
-- AES-256-GCM scheme as Environment Variables and is never returned by the
-- API. Rows are read when the auth context is built (process start), so an
-- admin change applies on the next control-plane restart.
CREATE TABLE "oauth_provider_config" (
  "provider" text PRIMARY KEY,
  "clientId" text NOT NULL,
  "clientSecret" text NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now()
);
