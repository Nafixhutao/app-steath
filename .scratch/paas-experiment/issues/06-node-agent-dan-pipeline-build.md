# 06: Node Agent dan pipeline Build

**What to build:** Node Agent Go berjalan dengan token auth, health, dan heartbeat. Control Plane membuat Job Build; agent melakukan clone repository publik, build Dockerfile dengan BuildKit, dan mengirim log. Deployment berhenti di status `deploying` setelah Build sukses, siap dilanjutkan tiket runtime.

**Blocked by:** 05

**Status:** ready-for-human

- [x] Node Agent Go berjalan sebagai service HTTP versioned dengan token auth dan health endpoint.
- [x] Node Agent mengirim heartbeat dan status node terlihat di Control Plane.
- [x] Control Plane membuat Job Build dan worker mengklaimnya dengan concurrency satu.
- [x] Node Agent clone repository publik pada branch yang diminta dan build Dockerfile dengan BuildKit.
- [x] Build log dialirkan ke Control Plane dan dapat dibaca dari dashboard.
- [x] Build sukses menyimpan image reference dan menandai Deployment `deploying`; Build gagal menandai `failed` tanpa mengubah versi lama.
- [x] Kontrak OpenAPI/JSON Schema dipakai oleh client TypeScript dan server Go.
- [x] Tes Node Agent dengan Docker mencakup Build sukses dan Build gagal.

## Implementation notes

The Node Agent is a Go service implementing `ServerInterface` from
`contracts/agent.openapi.yaml` v0.2.0. The same contract generates the TypeScript
client in `contracts/generated/agent.d.ts`, so the Control Plane and the agent
cannot drift without a compile error. `npm run contract:check` proves generation
is idempotent.

Endpoints: `GET /v1/health`, `GET /v1/node`, `POST /v1/builds`,
`GET`/`DELETE /v1/builds/{buildId}`, and `GET /v1/builds/{buildId}/logs`. The log
endpoint streams NDJSON and accepts an `after` cursor so a reconnecting reader
resumes instead of duplicating lines.

Build state lives in `agent/internal/build/manager.go`; cloning and BuildKit run
through the `Executor` seam in `executor.go`, which is what makes the Docker
tests real without mocking the builder. Builds are idempotent per `buildId`
(the Deployment id), so a retried `POST /v1/builds` returns the existing Build
instead of starting a second one.

Node health is derived from `lastSeenAt` rather than a stored flag, so a node
that dies stops being schedulable without needing a cleanup write. The Control
Plane treats a node as unhealthy after `NODE_HEARTBEAT_TIMEOUT_MS` (90s, three
missed heartbeats) and rejects new Deployments with `409 node_unhealthy`.

The worker (`worker/index.mts`) claims one Job at a time with
`FOR UPDATE SKIP LOCKED`, which gives the required Build concurrency of one per
node. It streams the agent log into the `build_log` table so the dashboard can
still read a Build log after the Build finished, and it completes the Job with
`succeeded` or `failed`. A failed Build marks the Job `failed` (terminal, never
retried) and re-derives the Service status: `running` when an older Deployment is
still serving, otherwise `not_deployed`. The previous version is never touched.

`ApiError` moved to `lib/platform/api-error.ts` and avoids TypeScript parameter
properties, because the worker runs through Node's type stripping. Modules used
by the worker import with explicit `.ts` extensions instead of the `@/` alias for
the same reason.

The dashboard gains a Deployments panel on the Service page (history, Deploy
button, node health, Build log, polling only while a Deployment is active), a
node badge on Overview, and node status on the Service list. `member` may
trigger a Deployment but still cannot manage resources.

Validation: `npm run typecheck`, `npm run lint`, `npm test` (47 tests),
`npm run test:go`, `npm run contract:check`, and `npm run build` all pass. The Go
suite covers the API handlers, the Build manager, heartbeats, and four real
Docker Builds (success, broken Dockerfile, missing Dockerfile, unknown branch).

Beyond the automated suite, the pipeline was verified end to end with a real Go
agent, the real worker, and BuildKit: a successful Build stored the image
reference and commit and moved the Deployment to `deploying`; a broken Build
ended in `failed` with `Build failed: exit status 1` and left the Service
retryable. Browser QA confirmed `Building` → `Deploying` in the dashboard, a
114-line Build log readable after completion, and a failed Build showing its
error message.
