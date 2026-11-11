# 18: Abuse Report dan Suspension

**What to build:** Publik dapat melaporkan Service yang melanggar aturan. Platform Admin dapat meninjau laporan, menangguhkan Service atau Organization, membatalkan Suspension, dan semua tindakan tercatat di audit.

**Blocked by:** 07, 17

**Status:** ready-for-human

- [x] Formulir Abuse Report publik menerima URL target, kategori, deskripsi, dan email pelapor opsional.
- [x] Formulir memakai rate limit dan challenge sederhana untuk mengurangi spam.
- [x] Platform Admin memiliki antrean laporan dengan status new, triaged, resolved, dan dismissed.
- [x] Suspension Service menghentikan container dan menampilkan halaman 503.
- [x] Suspension Organization menghentikan semua Service di Organization.
- [x] Unsuspend memulihkan Service yang sebelumnya berjalan; Service yang stopped tetap stopped.
- [x] Platform Admin dapat mencari Organization dan Service lintas tenant.
- [x] Setiap tindakan admin tercatat sebagai AuditEvent tanpa secret.
- [x] Tes mencakup alur laporan, suspension, unsuspend, dan isolasi data.
