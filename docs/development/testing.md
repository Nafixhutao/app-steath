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

## Contract

The Node Agent contract lives in `contracts/agent.openapi.yaml`. It is the source of truth for request, response, error, and status shapes.

Generated files:

- `contracts/generated/agent.d.ts`
- `agent/internal/api/generated.gen.go`

Do not edit generated files by hand. Run `npm run contract:generate` after changing the contract.

CI regenerates the contract and fails on drift. Pull requests also run `contract:breaking` with `CONTRACT_BASE_REF` set to the base branch, so an incompatible change fails before merge.

## Docker and Caddy

Docker is needed for the PostgreSQL test database and, later, for Node Agent integration tests. Node Agent tests use the real Docker engine through the Go seam.

Caddy is not needed for ticket 01 tests. From the routing tickets onward it runs as a Docker Compose service in front of the Control Plane, and route changes are asserted through the Node Agent seam. When Caddy is unavailable in CI, route behaviour is tested at the Node Agent seam and the full Caddy smoke test runs in staging.
