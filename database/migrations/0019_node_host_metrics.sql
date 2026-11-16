-- Node host metrics power the Platform Admin host dashboard. One row records
-- the node's own CPU, memory, and storage usage at a point in time, sampled by
-- the Node Agent from the kernel and collected by the worker. Resource usage of
-- Services and Databases lives in usage_snapshot; this table is the host itself.
CREATE TABLE "node_host_metric" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "nodeId" text NOT NULL REFERENCES "node"("id") ON DELETE CASCADE,
  "cpuPercent" numeric(5, 2) NOT NULL,
  "memoryUsedMb" integer NOT NULL,
  "memoryTotalMb" integer NOT NULL,
  "storageUsedMb" integer NOT NULL,
  "storageTotalMb" integer NOT NULL,
  "capturedAt" timestamp with time zone NOT NULL DEFAULT now()
);

-- The dashboard reads the history for one node inside a time window; the
-- retention pass deletes by age.
CREATE INDEX "idx_node_host_metric_node_captured"
  ON "node_host_metric" ("nodeId", "capturedAt" DESC);
