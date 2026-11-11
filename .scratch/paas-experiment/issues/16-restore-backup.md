# 16: Restore Backup

**What to build:** Owner/admin dapat memulihkan Database atau Volume dari Backup ke target asal dengan konfirmasi dan peringatan downtime. Restore menghentikan Service terkait, memulihkan data, lalu menyalakan kembali Service.

**Blocked by:** 15

**Status:** ready-for-human

- [x] Restore hanya dapat dilakukan ke target asal pada percobaan ini.
- [x] User melihat peringatan downtime dan harus mengetik konfirmasi sebelum restore.
- [x] Restore Database menghentikan Service di Project terkait, memulihkan Database, lalu menyalakan kembali Service.
- [x] Restore Volume menghentikan Service pemilik Volume, memulihkan isi Volume, lalu menyalakan kembali Service.
- [x] Restore memiliki status pending, running, completed, dan failed.
- [x] Setiap restore tercatat sebagai AuditEvent.
- [x] Kegagalan restore tidak menghapus data yang ada sebelum restore dimulai.
- [x] Tes mencakup restore Database dan Volume yang berhasil serta kegagalan restore.
