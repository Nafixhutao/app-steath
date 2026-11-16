# Architecture Review — 16 November 2026

Sumber: `docs/architecture-review-20261116.html` (laporan 8 kandidat, dibuat dari
sesi review arsitektur control plane).

## Status eksekusi

Seluruh 8 kandidat dieksekusi satu per satu, masing-masing di branch sendiri,
digate (tsc / lint / build / test dengan PostgreSQL scratch), di-deploy,
di-spot-check, lalu di-merge fast-forward ke `main` dan di-push.

| # | Kandidat | Hasil | Commit |
|---|----------|-------|--------|
| B | Dead code & file mati | −2.957 baris | (squash awal) |
| F | Modul `lib/platform/api.ts` (`withOrg`/`withAdmin`) | +445/−193 | `c21ae80` |
| D | Konsolidasi modul domain platform | +717/−884 | (3 commit) |
| C | Hook `useResource` + `getError` (17 panel) | +1187/−672 | (2 commit) |
| A | Satu transport HTTP (`lib/platform/http.ts`) | +210/−299 | `d8d86dd` |
| E | Scheduler + registry worker | +407/−178 | `5f421c6` |
| G | SQL admin keluar dari route handler | +1344/−744 | `edcb783` |
| H | Satu formatter waktu bersama | +30/−40 | `aebb02a` |

## Temuan di luar rencana

Test kandidat G menemukan dua bug laten di route admin yang sebelumnya tanpa
cakupan, keduanya diperbaiki di commit `edcb783`:

1. `db-metrics`/`redis-metrics` memilih kolom `"timestamp"` yang tidak ada di
   tabel (`capturedAt`) — endpoint akan 500 begitu ada sampel tersimpan.
2. `GET /api/admin/incidents` memanggil `.toISOString()` pada string ISO hasil
   `jsonb_agg` — endpoint 500 untuk incident yang punya event.

## Koreksi terhadap laporan

- Klaim "38 tipe duplikat" (kandidat A) tidak terverifikasi — tidak ada kontrak
  OpenAPI console; yang ada hanya `contracts/generated/agent.d.ts`.
- Kandidat H: duplikasi nyata hanya 7 copy `formatTime`; `formatSize`,
  `megabytes`, `shortCommit` masing-masing satu copy. Bagian di
  `features/admin/**` tidak disentuh (guard ADR-0008).

## Batas yang dijaga

`features/admin/**` dan `app/globals.css` tetap byte-identical dengan
stealth-forge (ADR-0008); guard `git diff main -- features/admin
app/globals.css` kosong di setiap commit.
