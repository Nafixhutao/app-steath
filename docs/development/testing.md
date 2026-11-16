# Testing

## Prerequisites

- Node.js 26+ and npm 11+
- Go 1.27+
- Docker Desktop with Linux containers
- PostgreSQL 16 from `docker compose`

On Windows, if `go` is not recognized after installation, restart the terminal. The Go binary lives in `C:\Program Files\Go\bin`.

## First run

```bash
docker compose up -d postgres
npm install
npm test
npm run test:go
```

`npm test` creates the `stealth_hosting_test` database if it does not exist, applies platform migrations, and runs the Control Plane API tests. Override the target with `TEST_DATABASE_URL` when needed. Test files that touch the platform database call `prepareTestDatabase()` from `tests/helpers/database.ts` in `beforeAll`.

## Commands

| Command                     | Purpose                                                                      |
| --------------------------- | ---------------------------------------------------------------------------- |
| `npm test`                  | Control Plane tests with Vitest                                              |
| `npm run test:watch`        | Control Plane tests in watch mode                                            |
| `npm run test:go`           | Node Agent tests with Go `testing`                                           |
| `npm run test:all`          | Control Plane tests, Node Agent tests, and contract drift check              |
| `npm run typecheck`         | TypeScript typecheck                                                         |
| `npm run contract:generate` | Generate the TypeScript client types and Go server from the OpenAPI contract |
| `npm run contract:check`    | Regenerate the contract and fail if generated files changed                  |
| `npm run contract:breaking` | Fail on incompatible contract changes against `CONTRACT_BASE_REF`            |
| `npm run ci`                | Typecheck plus the full test suite                                           |
| `npm run worker`            | Run the Deployment worker                                                    |
| `npm run agent:run`         | Run the Go Node Agent locally                                                |
| `npm run agent:build`       | Build the Node Agent binary into `dist/`                                     |

## Contract

The Node Agent contract lives in `contracts/agent.openapi.yaml`. It is the source of truth for request, response, error, and status shapes.

Generated files:

- `contracts/generated/agent.d.ts`
- `agent/internal/api/generated.gen.go`

Do not edit generated files by hand. Run `npm run contract:generate` after changing the contract.

CI regenerates the contract and fails on drift. Pull requests also run `contract:breaking` with `CONTRACT_BASE_REF` set to the base branch, so an incompatible change fails before merge.

## Docker and Caddy

Docker is needed for the PostgreSQL test database and for the Node Agent integration tests. Node Agent tests use the real Docker engine through the Go seam, so `docker version` must succeed before `npm run test:go`. Build tests skip themselves when Docker is unreachable instead of failing.

The Build tests in `agent/internal/build/docker_test.go` copy `test/fixtures/hello-docker` into a throwaway Git repository, so they prove the agent clones a real repository and builds with BuildKit. They cover a successful Build, a broken Dockerfile, a missing Dockerfile, and an unknown branch.

Caddy is not needed for the Build tests. From the routing tickets onward it runs as a Docker Compose service in front of the Control Plane, and route changes are asserted through the Node Agent seam. When Caddy is unavailable in CI, route behaviour is tested at the Node Agent seam and the full Caddy smoke test runs in staging.

## Deployment worker and Node Agent

The Control Plane and the worker are separate processes. The worker claims Build Jobs with `FOR UPDATE SKIP LOCKED` and processes one at a time, which gives the spec's Build concurrency of one per node.

```
npm run worker        # Control Plane side
npm run agent:run     # Node Agent side
```

Both need `AGENT_TOKEN`. The worker also needs `AGENT_BASE_URL` pointing at the agent, and the agent needs `CONTROL_PLANE_URL` to send heartbeats to `/api/nodes/heartbeat`. A node that has not heartbeated for 90 seconds is reported unhealthy and blocks new Deployments.

The Control Plane API tests in `tests/api/deployments.test.ts` use a fake Node Agent over HTTP, so they exercise the Deployment state machine (`queued → building → deploying`, and `failed` on a Build error) without Docker.

### Runtime environment

Running a Service needs the Node Agent to reach Caddy and Docker. These variables are read by the agent:

| Variable               | Default                  | Purpose                                                                     |
| ---------------------- | ------------------------ | --------------------------------------------------------------------------- |
| `CADDY_ADMIN_URL`      | `http://127.0.0.1:2019`  | Caddy admin API the agent rewrites routes through                           |
| `CADDY_CONTAINER_NAME` | `stealth-caddy`          | Caddy container the agent attaches to each Project network                  |
| `AGENT_PROBE_IMAGE`    | `busybox:1.36`           | Image for the one-shot health-check probe                                   |

Caddy must join every Project network to resolve the per-Deployment alias a route dials, which is why `CADDY_CONTAINER_NAME` has to match the container started by `docker compose up`. The Control Plane reads `PLATFORM_DOMAIN` to build Platform Subdomains; with `PLATFORM_DOMAIN=127.0.0.1.nip.io` a Service is reachable at `https://<name>-<suffix>.<ip>.nip.io`. Caddy uses `local_certs`, so the certificate comes from Caddy's internal CA and `curl -k` (or trusting the CA) is expected in development.
