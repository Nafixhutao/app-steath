# 09: Environment Variable

**What to build:** Owner/admin dapat menambah, mengubah, dan menghapus Environment Variable pada Service. Nilai rahasia disimpan terenkripsi, ditampilkan tersamar, dan baru aktif setelah redeploy.

**Blocked by:** 08

**Status:** ready-for-human

- [x] Environment Variable dapat ditambah, diubah, dan dihapus dengan key unik per Service.
- [x] Nilai disimpan dengan AES-256-GCM dan tidak pernah muncul di log atau AuditEvent.
- [x] API menampilkan nilai tersamar secara default; reveal hanya terjadi atas permintaan eksplisit.
- [x] Key `DATABASE_URL` dan prefix `STEALTH_` ditolak karena dicadangkan platform.
- [x] Perubahan menandai Service memerlukan redeploy dan nilai baru diterapkan saat Deployment berikutnya.
- [x] Environment Variable dihapus saat Service dihapus.
- [x] Tes API mencakup enkripsi, masking, reserved key, dan penerapan setelah redeploy.

## Implementation notes

**Schema.** `database/migrations/0008_environment_variables.sql` adds `environment_variable` with a `serviceId` foreign key that cascades on Service delete, so a secret never outlives the Service it belongs to. A unique index on `("serviceId", "key")` makes "the value the next Deployment uses" unambiguous and turns a duplicate key into a `409 environment_variable_exists`. The same migration adds `service.envRevision` and `deployment.envRevision`, both defaulting to `0`.

**Encryption.** `lib/platform/secrets.ts` seals values with AES-256-GCM and stores them as `v1.<iv>.<tag>.<ciphertext>`, each part base64. The IV is 12 random bytes per seal, so the same plaintext produces a different ciphertext every time and two Services cannot be spotted sharing a secret. The key comes from `ENV_ENCRYPTION_KEY` (64 hex characters or base64 decoding to exactly 32 bytes). A missing or malformed key answers `503 encryption_not_configured` instead of silently using a weak default; a ciphertext that fails the GCM check answers `500 environment_variable_unreadable`. Neither message names the value.

**API.** `listEnvironmentVariables` always returns `maskedValue: "********"`, a fixed-length placeholder that leaks neither the value nor its size. The only path that returns plaintext is `POST .../environment-variables/{variableId}/reveal`, which is a deliberate POST (never prefetchable, never cacheable) and sets `cache-control: no-store`. Owners and admins may reveal; members may list keys but not read values, matching the rule that the Platform Admin cannot see customer secrets either. Mutations are owner/admin only and each writes an AuditEvent (`environment_variable.created`, `.updated`, `.deleted`, `.revealed`) carrying `serviceId`, `variableId`, and `key` but never the value or ciphertext.

**Validation.** Keys must match `^[A-Za-z_][A-Za-z0-9_]*$`, at most 128 characters. `DATABASE_URL` and any key starting with `STEALTH_` are rejected case-insensitively with `400 reserved_environment_key`, because a lowercase shadow is still an attempt to shadow a platform-provided name. Values are strings up to 8192 characters without NUL bytes (`400 invalid_environment_value`).

**Redeploy signal.** Every mutation bumps `service.envRevision`. `runDeployment` reads the revision and its values in one statement (`loadDeploymentEnvironment`), records that revision on the Deployment, and sends the decrypted `environmentVariables` in the `POST /v1/deployments` body only when there is at least one. The Service therefore reports `needsRedeploy` exactly when its revision is newer than the newest `running` Deployment's revision. A failed decryption fails the Deployment with a reason that contains no value. The contract stays at v0.4.0 because `DeployRequest.environmentVariables` and the `EnvironmentVariable` schema already existed; the Go agent already passes them to `docker run --env`.

**Log safety.** `redactEnvironment` in `agent/internal/runtime/docker.go` replaces every Environment Variable value in a container-start error with `***` before the message leaves the agent, so a Docker error that echoes its `--env` arguments cannot carry a secret into `deployment.errorMessage`, the database, or the dashboard.

**Dashboard.** `environment-panel.tsx` lists Key / masked Value / Updated, offers Reveal per row (toggling to Hide), inline Edit, Add, and Delete, and shows a banner while `needsRedeploy` is true. `service-detail.tsx` renders it only for owners and admins. Members keep the read-only view of the rest of the Service.

**Verification.** `tests/api/environment-variables.test.ts` covers masking on create and list, the explicit reveal with `no-store`, ciphertext in the database (and a different ciphertext for the same plaintext), reserved and invalid keys, duplicate keys, update/delete, member `403` for create/update/delete/reveal, tenant `404`, AuditEvents that contain the key but not the value, cascade delete with the Service, and a full Deployment run that asserts the agent received the decrypted values and that `needsRedeploy` flips true on change and false after deploy. A Go unit test (`TestRedactEnvironmentHidesValuesInErrorMessages`) proves the redaction, including that empty values are skipped so unrelated text is not rewritten.

Exercised end to end with real Docker, Caddy, the worker, and the agent: adding `API_TOKEN` returned `********`; the row stored `v1.<iv>.<tag>.<ciphertext>` with no plaintext and `envRevision` became `1`; reveal returned the value with `cache-control: no-store`; both `STEALTH_SECRET` and `DATABASE_URL` were rejected with `400 reserved_environment_key`; a real Deployment ran the container with `API_TOKEN=qa-secret-value-123` (`docker inspect`) while `docker logs` contained no value; `needsRedeploy` was false after the deploy, true after rotating the value, and false again after redeploy, with the container then carrying only the new value. Deleting the Service removed its Environment Variables by cascade, and the QA rows, images, container, network, and Organization were cleaned up.
