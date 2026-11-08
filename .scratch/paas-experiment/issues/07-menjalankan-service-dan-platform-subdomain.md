# 07: Menjalankan Service dan Platform Subdomain

**What to build:** Node Agent menjalankan image hasil Build sebagai container dengan limit resource, network Project, dan hardening. Health check menentukan apakah traffic dipindahkan ke container baru. Platform Subdomain aktif dengan HTTPS melalui Caddy, dan user dapat stop, start, serta restart Service.

**Blocked by:** 06

**Status:** ready-for-human

- [x] Container berjalan non-root, tanpa privileged, tanpa Docker socket, tanpa port host, dengan limit 0,5 vCPU dan 512 MB RAM.
- [x] Container bergabung ke network Project dan hanya bisa diakses melalui Caddy.
- [x] Health check port dan health path berjalan maksimal 60 detik; container tidak sehat tidak menerima traffic.
- [x] Deployment sukses mengganti route ke container baru lalu menghentikan container lama.
- [x] Deployment gagal mempertahankan container lama; Deployment pertama yang gagal berakhir `failed`.
- [x] Platform Subdomain melayani HTTPS melalui Caddy dan `nip.io`.
- [x] Stop, start, dan restart Service bekerja tanpa menghapus data.
- [x] Runtime log dapat dibaca dan dialirkan ke dashboard.
- [x] Node Agent merekonsiliasi container dan route berlabel setelah restart.
- [x] Tes Node Agent dengan Docker dan Caddy mencakup deploy, health check gagal, dan stop/start.

## Implementation notes

**Contract.** `contracts/agent.openapi.yaml` is now v0.3.0 and adds the runtime surface: `POST /v1/deployments`, `GET`/`DELETE /v1/services/{serviceId}`, `POST /v1/services/{serviceId}/stop|start|restart`, and `GET /v1/services/{serviceId}/logs` (NDJSON with a `tail` cursor). New schemas: `DeployRequest`, `Deployment`, `ServiceState`, `RuntimeLogEvent`, `EnvironmentVariable`. `NodeInfo.status` accepts `ok|error`.

`RuntimeLogEvent` deliberately has no `stream` field: `docker logs` merges stdout and stderr without a marker, so reporting one would be a lie. `timestamp` is the time the container wrote the line (from `docker logs --timestamps`), not the time the agent read it, so a burst of buffered lines keeps the order and spacing the container produced.

**Container shape.** `stealth-svc-<serviceId>` on `stealth-project-<projectId>` with `--network` only, no published ports, non-root user, read-only root filesystem, `--cap-drop ALL`, `no-new-privileges`, a pids limit, and `NanoCpus=500000000` + 512 MB. The only ingress is Caddy on the Project network, which is why `CADDY_CONTAINER_NAME` must join every Project network before a route can resolve.

**Route swap.** A candidate container cannot be created with `--network none` and joined later, so it is created directly on the Project network under a per-Deployment alias. The route is only rewritten to that alias after the health check passes, which makes the swap a single atomic write and leaves the old container serving traffic while the candidate boots. The alias is `svc-` plus the first 32 hex characters of `sha256(serviceId + "\x00" + deploymentId)`; concatenating the ids produced a 77-character name that exceeded the 63-character DNS label limit and made Docker DNS fail to resolve it. After the swap the old container is renamed to `<name>-previous`, the candidate takes the stable name, and the old container is stopped and removed.

**Health check.** A one-shot `busybox:1.36` probe runs with `--network container:<id>` so it sees the candidate's loopback, first asserting something listens on the port and then that the health path returns 2xx. Failures carry a specific reason (`nothing is listening on port N`, `GET /path did not return a 2xx response`) instead of a bare timeout, and the whole check is bounded at 60 seconds.

**Caddy admin API.** `PUT` on an existing key returns `409 key already exists` and `PATCH` on a missing key fails, so routes are read, modified, and written back. `GET` on a deleted key returns `null` with status 200 rather than 404, so `readRoutes` treats `null` as "key absent" and chooses `PUT`; `isMissing` also covers `404` and `400 invalid traversal path`.

**Reconcile.** On startup the agent rebuilds its view from the `stealth.*` container labels: it re-attaches Caddy to the Project network, re-creates the network alias, and restores any route Caddy lost. A failure is logged rather than fatal so the agent can still serve Builds.

**Control Plane.** `lib/platform/runtime.ts` owns the tenant check and lifecycle calls, `lib/platform/deployments.ts` mirrors agent state onto the Deployment and Service rows, and the worker calls `runDeployment` after a successful Build so a Deployment only becomes `running` once the container is healthy. `app/api/services/[serviceId]/logs/route.ts` streams NDJSON with a clamped `tail` (200 default, 1000 maximum) and returns 409 when the Service has no container.

**Permissions.** Deployment is allowed for `owner`, `admin`, and `member` (a member may ship code), while stop, start, and restart require `owner` or `admin`. Runtime log reads are allowed for all three. Every action records an AuditEvent with the acting user: `deployment.triggered`, `service.stopped`, `service.started`, `service.restarted`.

**Verification.** The real Docker and Caddy tests run rather than skip: `TestDockerDeployRunsAHardenedLimitedContainer`, `TestDockerDeployFailsWhenTheHealthCheckNeverPasses`, `TestDockerStopStartKeepsTheContainerAndItsData`, and `TestCaddyServesThePlatformSubdomain`. They were also exercised end to end through the Control Plane: a Deployment went `queued → running` in ten seconds, `https://<service>.<ip>.nip.io` served the app over Caddy's internal CA, stop pulled the route and dropped the HTTPS connection, start brought back the same container (`Created` unchanged), restart kept the same container, and the runtime log streamed NDJSON lines whose timestamps matched the container's own write times. Deleting the route by hand and restarting the agent restored it from the container label. A Deployment of a deliberately broken image failed with `The container exited before it became healthy.` while the old container kept serving and no candidate container was left behind.
