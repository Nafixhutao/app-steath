# 03: Undangan dan Role Organization

**What to build:** Owner/admin dapat mengundang anggota lewat tautan yang bisa disalin, menerima undangan, dan mengelola Role. Izin owner/admin/member ditegakkan pada resource Organization.

**Blocked by:** 02

**Status:** ready-for-human

- [x] Undangan menghasilkan tautan salin dengan masa berlaku tujuh hari.
- [x] Penerimaan undangan menambah Member; tautan tidak valid atau kedaluwarsa ditolak.
- [x] Owner/admin/member hanya bisa melakukan aksi yang diizinkan.
- [x] Owner dapat mengeluarkan Member; Member dapat leave.
- [x] Owner dapat rename dan delete Organization dengan konfirmasi teks.
- [x] Owner terakhir tidak dapat dihapus atau diturunkan.
- [x] AuditEvent tercatat untuk perubahan membership dan Role.
- [x] Tes mencakup matriks izin dan alur undangan.

Implementasi dan verifikasi otomatis selesai: `npm run typecheck`, `npm run lint`, `npm test` (4 file, 16 tes), dan `npm run build` lulus.

Verifikasi browser (agent-browser) mencakup: pembuatan tautan undangan dan salinannya, masa berlaku tujuh hari, penerimaan undangan oleh user baru termasuk kembali ke tautan setelah signup, penolakan tautan invalid dan kedaluwarsa, decline, tampilan serta pembatasan owner/admin/member, perubahan Role, removal, leave, rename, delete dengan konfirmasi nama, proteksi owner terakhir, dan isi AuditEvent (aktor dan target).

Perbaikan yang ditemukan saat verifikasi browser:

- Halaman undangan membaca sesi di server agar penerima yang baru signup tidak terlempar kembali ke halaman login.
- Login/signup menghormati `returnTo` sehingga tautan undangan berlanjut setelah autentikasi.
- Daftar undangan hanya menampilkan status `pending` yang belum kedaluwarsa.
- Dashboard menampilkan pembuatan Organization ketika user tidak punya membership, dan memilih Organisasi tersisa saat Organisasi aktif terhapus atau ditinggalkan.
- Audit perubahan Role dan removal memakai route server kustom agar aktor dan target tercatat benar.
