<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Perintah

- `npm run ci` — gerbang CI yang sebenarnya: `next typegen` → `typecheck` → `test:all`. Pakai ini sebelum push; `npm run lint` dan `npm run format:check` tidak dijalankan CI, jadi panggil sendiri.
- `npm test` — Vitest untuk `tests/**` dan `worker/**`, serial (`fileParallelism: false`). Butuh PostgreSQL hidup; `tests/helpers/database.ts` membuat database `stealth_hosting_test` sendiri (override lewat `TEST_DATABASE_URL`). Redis hanya dipakai `tests/platform/redis.test.ts`.
- `npm run test:go` — tes Node Agent; memakai engine Docker sungguhan sehingga `docker version` harus berhasil. Tes build melewati dirinya sendiri bila Docker mati.
- `npm run contract:generate` setelah mengubah `contracts/agent.openapi.yaml`. Keluarannya `contracts/generated/agent.d.ts` dan `agent/internal/api/generated.gen.go`; jangan diedit tangan, dan commit hasil generate (CI gagal pada drift).
- Dev: `docker compose up -d postgres`, `npm run db:migrate`, lalu `npm run dev`. Proses terpisah: `npm run worker` dan `npm run agent:run`, keduanya butuh `AGENT_TOKEN`.
- Node di image produksi `node:24-bookworm-slim` walau CI memakai Node 26 — jangan pakai API yang hanya ada di 26.

## Deploy

Setiap perubahan langsung di-deploy ke produksi (VPS ini, `https://console.nazxf.my.id`) supaya user bisa memverifikasi dan melanjutkan instruksi berikutnya:

```bash
sg docker -c "docker compose -f docker-compose.production.yml up -d --build control-plane"
```

- `Dockerfile` harus tetap multi-stage: `deps` → `builder` → `runner`. Runner **bukan** `.next/standalone`; ia menyalin `lib/`, `worker/`, `scripts/migrate.mts`, dan `database/` apa adanya karena worker dan migration runner meng-import `lib/` langsung. Menyederhanakannya jadi standalone akan mematahkan runtime.
- Service `migrate` jalan sekali tiap `up` dan menerapkan `database/migrations/*.sql` di bawah advisory lock; file migrasi baru otomatis ikut ter-deploy. Jangan menjalankan migrasi manual.
- `NEXT_PUBLIC_BETTER_AUTH_URL` di-inline saat build. Kalau domain/origin berubah, build ulang tanpa cache, bukan sekadar restart.
- Verifikasi hasil deploy: `GET /api/health` → `200 {"status":"ok","database":"ok","migrations":"ok"}`.
- Detail operasional (tunnel, restart, kredensial OAuth provider) ada di `docs/deployment/vps.md`.

## Arsitektur

- `app/` route Next.js App Router; `app/api/**` adalah Control Plane API. `components/` untuk UI bersama, `lib/*-client.ts` untuk pemanggilan API dari klien.
- `lib/platform/**` adalah service layer server: repository PostgreSQL, state machine Deployment, backup, kuota, audit. Jangan taruh logika domain di route handler.
- `worker/` proses worker: klaim Build Job (`FOR UPDATE SKIP LOCKED`, satu per node) lalu memanggil Node Agent. Efek samping runtime Docker hanya boleh lewat Agent.
- `agent/` module Go `stealth/agent` — satu-satunya proses yang memegang `/var/run/docker.sock`; ia juga memprogram Caddy lewat admin API dan join network tiap Project. Kontrak HTTP-nya `contracts/agent.openapi.yaml`.
- `database/migrations/` bernomor berurutan dan dijalankan `scripts/migrate.mts`; `scripts/generate-auth-schema.mts` hanya mencetak SQL Better Auth, bukan sumber migrasi.

## Konvensi yang mudah dilanggar

- `features/admin/**` adalah salinan verbatim stealth-forge: **jangan diedit** (ADR-0008). Adaptasi hanya di `app/admin/**` lewat import, `className`, atau komposisi; perbedaan yang tak bisa diselesaikan dari call site adalah keputusan produk baru.
- Override palet halaman auth ada di blok akhir `app/globals.css` dan seluruhnya di-scope `.auth-page`; console user dan panel admin tidak boleh ikut berubah. Token dan komentar di blok itu merujuk design system Cloudflare, bukan nilai acak.
- `features/admin` dan console memakai token warnanya sendiri; jangan menaikkan selector auth ke level global.

## Styling

- Default: semua styling UI lewat utility Tailwind di JSX. Coba utility dulu, termasuk arbitrary value (`text-[13px]`, `bg-[#0a0a0a]`, `[&>svg]:…`, `max-[480px]:…`) sebelum menulis CSS.
- `app/globals.css` hanya untuk yang tidak mungkin jadi utility: token `@theme`, `@keyframes`, selector elemen/reset global yang memang unlayered, dan plumbing `features/admin`/`[data-admin]`. Jangan tambah class CSS baru, file CSS baru, `@import` baru, `@apply`, atau `!important` baru.
- Kalau utility kalah cascade, perbaiki rule unlayered yang menang (hapus atau scope), bukan menyalin nilainya ke CSS baru. Verifikasi dengan `npm run build` dan cek chunk CSS hasil build.
- Pola berulang tetap utility; bila perlu dipakai ulang, ekspor string class dari TS (contoh `authSubmitClass` di `components/auth-form.tsx`), bukan membuat class CSS.

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five default triage roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the repo root and ADRs under `docs/adr/`. See `docs/agents/domain.md`.

### AI SDK

- Repo ini belum memakai paket `ai`. Jangan pasang kecuali ada fitur AI yang benar-benar diminta.
- Begitu menyentuh AI (`generateText`, `streamText`, `useChat`, tool calling, embedding, agent), muat skill `ai-sdk` lebih dulu dan verifikasi tiap API ke `node_modules/ai/docs/` + `node_modules/ai/src/`. Jangan menulis dari ingatan: API dan model ID sering berubah antar versi.
- Upgrade SDK 6 → 7 pakai skill `migrate-ai-sdk-v6-to-v7`, bukan tebakan.

## Pull Request

Setiap kali saya meminta membuat, menulis, atau memperbarui PR (termasuk deskripsi/body PR), WAJIB gunakan skill `pr`. Ikuti template-nya: Summary, Evidence (before/after), dan Merge Danger (Door + Blast Radius). Jangan menulis body PR dengan format lain.
