# 01: Fondasi test dan kontrak agent

**What to build:** Fondasi yang membuat tiket berikutnya bisa diuji dari dua seam: API Control Plane dan API Node Agent. Control Plane memakai Vitest dan PostgreSQL test database; Node Agent memakai Go `testing`; kontrak OpenAPI/JSON Schema menjadi sumber kebenaran dan menghasilkan client TypeScript serta server stub Go.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Control Plane test suite berjalan dengan PostgreSQL test database yang dibuat dan dimigrasikan otomatis.
- [x] Node Agent memiliki Go module dan `go test ./...` berjalan.
- [x] Kontrak OpenAPI/JSON Schema tersedia dan generation client TypeScript + server stub Go dapat diulang.
- [x] Generated code dikompilasi dan contract drift menggagalkan CI.
- [x] Fixture repository dengan Dockerfile tersedia untuk tes Build.
- [x] Perintah CI menjalankan test Control Plane dan Node Agent.
- [x] Dokumentasi singkat cara menjalankan tes dengan Docker dan Caddy tersedia.

## Comments

- Vitest menjalankan tes Control Plane; `tests/helpers/database.ts` membuat `stealth_hosting_test` dan menjalankan migrasi lewat `prepareTestDatabase()`.
- Go module `agent` memiliki tes health endpoint dengan bearer auth; `npm run test:go` menjalankan `go test ./...`.
- `contracts/agent.openapi.yaml` menghasilkan `contracts/generated/agent.d.ts` (openapi-typescript) dan `agent/internal/api/generated.gen.go` (oapi-codegen). Keduanya dipin ke versi tetap.
- `npm run contract:check` mendeteksi drift; `npm run contract:breaking` memakai oasdiff terhadap `CONTRACT_BASE_REF` dan berjalan di pull request CI.
- Fixture Dockerfile ada di `test/fixtures/hello-docker/`; tes Build akan menyalinnya ke repository Git sementara.
- Dokumentasi ada di `docs/development/testing.md`, termasuk Docker, Caddy, dan perintah kontrak.
- Verifikasi: `npm run test:all`, `npm run typecheck`, `npm run lint`, `npm run build` semuanya lulus.
