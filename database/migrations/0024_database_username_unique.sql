-- The readable Database username is allocated with a random suffix and only
-- checked with a `SELECT` before the `INSERT`, so two concurrent creations
-- could both pass the check. The Control Plane serializes the allocation with
-- an advisory lock; this unique index is the last line of defense, and its
-- name is what `createProjectDatabase` maps to a retryable 503.
CREATE UNIQUE INDEX "database_username_key" ON "database" ("username");
