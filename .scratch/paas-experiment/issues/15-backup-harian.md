# 15: Backup harian

**What to build:** Platform membuat Backup harian untuk setiap Database, Volume, dan PostgreSQL platform. Backup diunggah ke S3-compatible jika tersedia, dengan fallback lokal dan peringatan. Retensi tujuh hari dan daftar Backup terlihat di dashboard.

**Blocked by:** 10, 11

**Status:** ready-for-human

- [x] Backup berjalan otomatis setiap hari pukul 02.00 UTC untuk Database, Volume, dan PostgreSQL platform.
- [x] Database memakai `pg_dump` format custom; Volume memakai arsip terkompresi; platform memakai `pg_dump`.
- [x] Backup diunggah ke S3-compatible dengan server-side encryption.
- [x] Jika kredensial S3 tidak tersedia, Backup disimpan lokal dan dashboard menampilkan peringatan.
- [x] Daftar Backup menampilkan target, waktu, ukuran, dan status.
- [x] Backup dan metadata lebih dari tujuh hari dihapus otomatis.
- [x] Kegagalan Backup terlihat di dashboard dan tercatat sebagai AuditEvent.
- [x] Tes mencakup penjadwalan, upload, fallback lokal, dan retensi.
