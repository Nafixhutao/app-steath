# 08: Riwayat Deployment, redeploy, cancel, dan cleanup

**What to build:** Anggota Organization dapat melihat riwayat Deployment, memicu redeploy pada commit yang sama, dan membatalkan Deployment yang masih queued atau building. Log disimpan tujuh hari dan image lama dibersihkan otomatis.

**Blocked by:** 07

**Status:** ready-for-human

- [x] Riwayat Deployment menampilkan status queued, building, deploying, running, failed, dan cancelled.
- [x] Setiap Deployment menampilkan commit SHA, waktu mulai, waktu selesai, durasi, dan pesan error.
- [x] Redeploy memakai commit yang sama dan membuat Deployment baru.
- [x] Cancel menghentikan Build jika memungkinkan dan tidak meninggalkan container atau image yatim.
- [x] Build log dan runtime log disimpan maksimal tujuh hari.
- [x] Hanya tiga image terakhir per Service yang dipertahankan; image lama dibersihkan.
- [x] Build cache dipangkas mingguan dan cleanup berjalan saat Node Agent start.
- [x] Tes mencakup history, redeploy, cancel, retensi log, dan cleanup.

## Implementation notes

**Contract.** `contracts/agent.openapi.yaml` is now v0.4.0. It adds `POST /v1/deployments/{deploymentId}/cancel` (`cancelDeployment`), the `DeploymentId` path parameter, an optional `commitSha` on `BuildRequest`, and the `CancelDeploymentRequest` / `DeploymentAbort` schemas. Cancelling through the agent, rather than only deleting the Build, is what makes "no orphaned container or image" enforceable: the agent is the only party that knows the container and image names.

`DeploymentAbort` reports `buildCancelled`, `containersRemoved`, and `imageRemoved` so the Control Plane logs what the node actually cleaned up instead of assuming success. `CancelDeploymentRequest.imageRef` is optional because the Control Plane may cancel a Deployment whose Build never reported an image; it now always sends the deterministic `stealth/service-<serviceId>:<deploymentId>` tag, so an image a cancelled Build had already tagged is still removed.

**Redeploy.** `POST /api/deployments/{deploymentId}/redeploy` reads the commit from the stored Deployment, not from the request, so a redeploy cannot be talked into building different code. The new Deployment records that commit immediately, which makes the history show what is being rebuilt while it is still queued, and `runBuildJob` forwards it as `BuildRequest.commitSha`. The agent clones the branch, then `git fetch --depth 1 origin <sha>` and `git checkout <sha>` when the tip differs; a server that refuses a fetch by id falls back to fetching the branch. A commit that cannot be resolved fails the Build with the SHA in the message instead of silently building the tip.

**Cancel.** `POST /api/deployments/{deploymentId}/cancel` is limited to `owner` and `admin` and only accepts `queued` or `building`, answering `409 deployment_not_cancellable` otherwise. `markDeploymentCancelled` moves the Deployment to `cancelled`, cancels its Job, and re-derives the Service status: `running` when an older Deployment still serves, `not_deployed` when this was the first attempt. The route is never touched. The Control Plane marks the Deployment cancelled even when the agent cannot be reached, because the worker refuses to build a cancelled Deployment; the agent's startup Cleanup then removes anything that attempt left behind.

`Abort` never removes a running container under the stable `stealth-svc-<serviceId>` name, so a cancel that races a promotion cannot take a working Service down. It removes containers labelled with the cancelled `stealth.deploymentId` and deletes the image only when no container references it, including `exited` ones, which keeps Start working.

**Retention.** Build logs are pruned by `pruneLogs`, which the worker calls at most once an hour, deleting `build_log` rows older than seven days. Runtime logs are never copied into the database: they are read from the container, and the agent now passes `--since 168h` to `docker logs`, so a line older than the window is never handed to the dashboard. Containers also run with the `local` log driver, `max-size=10m`, and `max-file=5`, so a chatty application cannot fill the node's disk.

**Image and cache cleanup.** `PruneImages` keeps the newest `ImageRetention = 3` images per repository (`stealth/service-<serviceId>`) and skips any image a container still uses, so a stopped Service can still be started. `Cleanup` removes leftover `-candidate` containers and then prunes the Build cache, and the agent runs it after `Reconcile` on startup so containers it just adopted are not mistaken for leftovers. The weekly cache prune is recorded in `<workRoot>/cleanup.json`; without that path the prune is skipped.

**Dashboard.** `deployments-panel.tsx` gained a Duration column (derived from `startedAt`/`finishedAt`, `—` when either is missing) and, for `owner` and `admin`, a Redeploy button and a Cancel button that only appears while the Deployment is `queued` or `building`. Members keep the read-only view plus View log.

**Verification.** `tests/api/deployments.test.ts` grew from 11 to 18 tests covering the history fields, redeploy pinning the same commit, cancel of a queued Deployment, cancel that keeps a running Service serving, the `409` for a finished Deployment, the role check, the AuditEvent, and log retention. Go tests cover the pinned commit (`TestStartBuildChecksOutAPinnedCommit`, `TestStartBuildSkipsTheFetchWhenTheTipIsThePinnedCommit`, `TestStartBuildFallsBackToTheBranchWhenTheCommitCannotBeFetched`, `TestStartBuildFailsWhenThePinnedCommitIsUnavailable`) and the cleanup rules (`cleanup_test.go`, 9 tests).

Exercised end to end with real Docker and Caddy: a Deployment went `queued` to `running` in nine seconds and served `https://<service>.<ip>.nip.io` over HTTPS; redeploy created a new Deployment that rebuilt the same commit and its Build log showed `Checked out commit 4bec5f8...`; cancelling a `queued` Deployment left the Service `running` and the route serving; cancelling a `building` Deployment reported `buildCancelled: true` and removed the image the Build had already tagged; the agent's startup Cleanup removed a leftover candidate container and pruned five tagged images down to the newest three; `pruneLogs` deleted exactly the 58 aged lines and left the 59 fresh ones. The dashboard showed the Duration column and the Redeploy/Cancel actions, and cancelling a `queued` Deployment from the UI turned the row `Cancelled` with no console errors.
