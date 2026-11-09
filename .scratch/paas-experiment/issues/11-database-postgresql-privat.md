# 11: Database PostgreSQL privat

**What to build:** Setiap Project dapat memiliki satu Database PostgreSQL 16. Database berjalan di network Project, hanya dapat diakses Service dalam Project yang sama, dan `DATABASE_URL` di-inject otomatis.

**Blocked by:** 10

**Status:** ready-for-human

- [x] Satu Database dapat dibuat per Project; Database kedua ditolak dengan error Quota.
- [x] Database berjalan sebagai container PostgreSQL 16 dengan Volume sendiri dan tanpa port host.
- [x] Database hanya dapat diakses dari network Project yang sama.
- [x] Kredensial dibuat acak, disimpan terenkripsi, dan dapat dirotasi.
- [x] Connection string privat ditampilkan dan `DATABASE_URL` di-inject ke semua Service di Project.
- [x] User tidak dapat menimpa `DATABASE_URL` melalui Environment Variable.
- [x] Database memiliki status kesehatan dan batas storage 1 GB.
- [x] Delete Database memakai konfirmasi dan mencatat AuditEvent.
- [x] Tes Node Agent membuktikan Service bisa connect dan host tidak bisa connect secara default.
