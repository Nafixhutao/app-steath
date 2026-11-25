# Spec: S3 self-hosted (Object Storage ala Supabase)

Status: `ready-for-agent` — Fase 1 (MVP) sedang diimplementasikan.
Keputusan: [ADR-0013](../../docs/adr/0013-shared-s3-object-storage.md).

## Tujuan

Customer mendapat S3 bucket per Project: dibuat dari dashboard, langsung bisa dipakai aplikasi customer via AWS SDK dengan Access Key/Secret Key, endpoint HTTPS publik, bucket Public/Private, dan kuota hard. Tidak ada plan/billing baru; kuota mengikuti `QUOTAS` yang ada.

## Ruang lingkup MVP

- Satu server MinIO bersama (`minio`, volume `minio_data`) di Compose; Agent memegang rute Caddy dan operasi IAM/bucket via CLI `mc`.
- Tabel `storage_bucket` (migrasi `0025`) — lihat `lib/platform/storage.ts` untuk sumber kebenaran konfigurasi.
- Operasi: create (nama + public + quota), list + status/usage, reveal secret, delete dengan konfirmasi nama.
- Kuota: `bucketsPerProject = 3`, `bucketStorageMb = 1024` (ditegakkan MinIO).
- Panel "Storage" di detail Project.

## Non-goal Fase 1

- File browser/web console MinIO, versioning, lifecycle, CORS UI, policy kustom per objek.
- Presigned URL yang dihasilkan Control Plane (customer memakai SDK dengan kredensial yang diberikan).
- Tagihan/plan berbayar; kuota per-Organization terukur dalam snapshot (bisa menyusul).

## Alur

```
Dashboard → API /api/projects/[id]/storage → lib/platform/storage.ts
   → assertQuota + DB (nama, accessKey, secret terenkrip)
   → nodeAgent → Agent /v1/storage/buckets/{bucketId} → mc → MinIO
Browser customer → https://s3.<platform-domain>/<bucket>/<key>
   → Cloudflare tunnel → Caddy (rute host s3.*) → MinIO
```

## Kriteria selesai

- `npm run ci` hijau (typegen → typecheck → test:all).
- `npm run test:go` sukses (butuh Docker).
- Deploy produksi + `GET /api/health` → ok; smoke test create/list/reveal/delete bucket.
