-- A ScanFinding is one result from scanning a built image. Scanning is advisory:
-- a finding never suspends a Service by itself, but a high-severity malware
-- finding is marked urgent so the Platform Admin sees it first. Findings belong
-- to a Deployment and disappear with it, because they describe that image.
CREATE TABLE "scan_finding" (
  "id" text PRIMARY KEY,
  "deploymentId" text NOT NULL REFERENCES "deployment" ("id") ON DELETE CASCADE,
  "scanner" text NOT NULL,
  "severity" text NOT NULL,
  "title" text NOT NULL,
  -- Scanner-specific fields (package, version, path, rule id) as reported. They
  -- are free-form because Trivy and ClamAV describe findings differently.
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- A high-severity malware match is urgent; vulnerabilities are not, because a
  -- theoretical weakness is not the same as a known malicious file.
  "urgent" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "scan_finding_scanner_values" CHECK (
    "scanner" IN ('trivy', 'clamav')
  ),
  CONSTRAINT "scan_finding_severity_values" CHECK (
    "severity" IN ('critical', 'high', 'medium', 'low', 'info', 'unknown')
  )
);

CREATE INDEX "idx_scan_finding_deployment"
ON "scan_finding" ("deploymentId", "createdAt" DESC);

-- The admin queue reads urgent findings first, so the partial index keeps that
-- query small even when the table grows with every Deployment.
CREATE INDEX "idx_scan_finding_urgent"
ON "scan_finding" ("createdAt" DESC)
WHERE "urgent";
