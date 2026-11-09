# 10: Volume persisten

**What to build:** Setiap Service dapat memiliki satu Volume dengan mount path dan batas 1 GB. Data bertahan saat restart dan redeploy, pemakaian terlihat, dan Volume dihapus bersama Service setelah konfirmasi.

**Blocked by:** 08

**Status:** ready-for-human

- [x] Service dapat memiliki paling banyak satu Volume dengan mount path dan ukuran 1 GB.
- [x] Volume dibuat dan dipasang ke container oleh Node Agent.
- [x] Data di Volume bertahan setelah restart dan redeploy.
- [x] Pemakaian Volume terlihat di dashboard Service.
- [x] Batas 1 GB ditegakkan pada level Node Agent.
- [x] Menghapus Service dengan konfirmasi menghapus container dan Volume terkait.
- [x] Volume berlabel Organization, Project, Service, dan Deployment.
- [x] Tes Node Agent mencakup persistensi data dan cleanup Volume.

## Implementation notes

**Contract.** `contracts/agent.openapi.yaml` is now v0.5.0. `DeployRequest.volume` is an optional `VolumeMount {name, mountPath, sizeMb}`, so the same Deploy that starts the container also tells the node which Volume to mount. `PUT/GET/DELETE /v1/volumes/{name}` expose the node's Volume operations: `PUT` creates or adopts the Volume and returns `VolumeInfo`, `GET` reports `{name, sizeMb, usageMb, exists}` (with `sizeMb` echoed from a query parameter), and `DELETE` answers `VolumeRemoval {name, removed}`. A Volume that is already gone is not an error on `DELETE`, because cleanup must be retryable.

**Schema.** `database/migrations/0009_volumes.sql` adds `volume` with a `UNIQUE` `serviceId` foreign key that cascades on Service delete. The unique constraint, not application code, is what guarantees "at most one Volume per Service" under concurrent creates. `dockerVolumeName` is derived deterministically from the Service id (`stealth-vol-<serviceId>`) and stored, so renaming a Service never moves the data. `sizeMb` defaults to `1024` and a check constraint keeps it between 1 and 1024.

**Agent Volume lifecycle.** `agent/internal/runtime/docker.go` adds `EnsureVolume`, `VolumeUsage`, `RemoveVolume`, and `ListVolumes` to the Docker interface. `EnsureVolume` inspects first and returns untouched when the Volume exists, so a redeploy never replaces data or rewrites labels. On creation it labels the Volume with `stealth.type=volume` plus the Organization, Project, Service, and (when present) Deployment ids, then opens the directory with `chmod 0777` through a throwaway BusyBox container. That last step matters: Docker creates a named Volume owned by root while a Service image usually runs as a non-root user, so without it the application cannot write to its own Volume. The mount is added with `--mount type=volume,source=...,target=...`; the container also records `stealth.volumeName`, `stealth.volumePath`, and `stealth.volumeSizeMb`, which is how enforcement finds the limit without asking the Control Plane.

**Limit enforcement.** `MaxVolumeSizeMB` is 1024. A Deploy refuses to start when the existing Volume already uses more than its limit, so an over-quota Service cannot keep restarting into the same state. Because Docker's local driver has no per-Volume quota, `Manager.EnforceVolumes` measures every running Service Volume and stops a container that grew past its limit; `cmd/agent/main.go` runs it every minute. Usage is measured with `du -sk` in a read-only throwaway container and rounded up, so a Volume one byte over a megabyte is reported as over the limit rather than truncated back under it.

**Removal and cleanup.** `Manager.Remove` now deletes the container, its route, and every labelled Volume belonging to the Service, even when the container was already gone. `Cleanup` additionally prunes orphan Volumes whose Service no longer has a container; a stopped Service keeps its container, so its Volume is never mistaken for an orphan. `CleanupReport.VolumesRemoved` reports the count in the startup and weekly cleanup log.

**Control Plane.** `lib/platform/volumes.ts` owns the row. Mount paths must be absolute, at most 255 characters, free of `.`/`..` segments, and limited to characters that cannot break the `--mount` argument (`400 invalid_mount_path`). The size defaults to 1024 and must be a whole number between 1 and 1024 (`400 invalid_volume_size`). A duplicate answers `409 volume_exists`. Creating or deleting a Volume bumps the Service's configuration revision, which is the same revision `needsRedeploy` compares, so a Volume change is visibly pending until the next Deployment. `getServiceVolume` asks the agent for the measured usage; an unreachable node returns `usageMb: null` instead of failing the whole dashboard.

**Deployment.** `loadDeploymentVolume` reads the row and `runDeployment` adds `volume` to the `POST /v1/deployments` body. The Docker Volume is therefore created on the first Deployment that needs it, which is also the first moment a Deployment id exists to label it with. `needsRedeploy` flips true when the Volume row changes and false once a running Deployment records the new revision.

**Deletion.** `DELETE /api/services/{serviceId}/volume` asks the agent to remove the Docker Volume before deleting the row, so a node failure leaves the row in place for a retry. A Volume still referenced by a container answers `409 volume_in_use` with "Stop the Service before deleting its Volume." The normal path is deleting the Service: its confirmation removes the container and the Volume together, and the `volume` row cascades with the Service.

**API and audit.** `app/api/services/[serviceId]/volume/route.ts` lets every role read (`GET`), and limits `POST`/`DELETE` to owners and admins. `volume.created` records `serviceId`, `volumeId`, `mountPath`, and `sizeMb`; `volume.deleted` records `serviceId`, `volumeId`, and `dockerVolumeName`. No audit event carries file contents.

**Dashboard.** `volume-panel.tsx` is rendered for every role. Members see the mount path, size, measured usage, and a usage bar; owners and admins additionally get the Add form and Delete. While `needsRedeploy` is true the panel repeats the redeploy banner, because a new or deleted Volume is not live until the next Deployment.

**Verification.** `tests/api/volumes.test.ts` covers create and duplicate `409`, mount-path and size validation, member `403` for create/delete while keeping read access, tenant `404`, the Volume appearing in the Deployment request (and clearing `needsRedeploy`), usage from the agent, agent-first deletion with AuditEvents, and cascade delete with the Service. Go unit tests cover Volume creation and mounting, keeping existing data, refusing an over-quota Deploy, usage reporting, `EnforceVolumes`, `Remove` deleting the Volume, orphan-Volume cleanup, and request validation. The Docker integration test builds an image that runs as uid `1000`, writes a file into `/data`, restarts, redeploys, proves the file survives both, and proves `Remove` deletes the Volume.

Exercised end to end with real Docker, Caddy, the worker, and the agent: a Volume created with `mountPath=/data` and `sizeMb=1024` produced a Docker Volume labelled with `stealth.organizationId`, `stealth.projectId`, `stealth.serviceId`, `stealth.deploymentId`, and `stealth.type=volume`; the container (running as `node`, uid 1000) could write `/data/proof.txt`; `GET /api/services/{id}/volume` reported `usageMb: 1` and `exists: true`; the file survived a restart and a full redeploy; a 1 MB Volume filled with 2 MB was reported as 3 MB and its container was stopped by the enforcement loop within one minute; deleting the Volume while the container existed answered `409 volume_in_use`; deleting the Service removed the container, the Docker Volume, and the `volume` row. QA rows, images, network, and Organization were cleaned up.
