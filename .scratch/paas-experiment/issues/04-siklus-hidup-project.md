# 04: Siklus hidup Project

**What to build:** Anggota Organization dapat membuat, melihat, membuka, mengubah, dan menghapus Project. Halaman Project menjadi wadah Service dan Database, dengan Quota tiga Project per Organization.

**Blocked by:** 03

**Status:** ready-for-human

- [x] Create Project dengan slug unik per Organization.
- [x] List dan overview menampilkan nama, slug, jumlah Service/Database, dan status ringkas.
- [x] Owner/admin dapat mengganti nama dan slug.
- [x] Delete Project memakai konfirmasi teks dan mencatat AuditEvent.
- [x] Project keempat ditolak dengan error Quota yang menyebut batas dan pemakaian.
- [x] Member hanya dapat melihat.
- [x] Tes API dan smoke test UI mencakup alur Project.

Implementasi dan verifikasi otomatis selesai: `npm run typecheck`, `npm run lint`, `npm test` (5 file, 25 tes), dan `npm run build` lulus.

Verifikasi browser (agent-browser) mencakup: pembuatan Project dengan slug otomatis dari nama, daftar Project dengan jumlah Service/Database dan status ringkas, halaman detail Project, rename nama dan slug, penolakan slug duplikat di dalam Organization, penolakan Project keempat, delete dengan konfirmasi nama (tombol terkunci saat nama salah), tampilan read-only untuk member, dan isolasi tenant (Organization lain tidak melihat maupun membuka Project tersebut).

Catatan implementasi:

- Quota disimpan sebagai konstanta bersama di `lib/platform/quota-limits.ts` sehingga API dan dashboard membaca angka yang sama; `lib/platform/quota.ts` menambahkan error Quota berstatus 409.
- Pembuatan Project memakai advisory lock per Organization agar dua request bersamaan tidak bisa melampaui Quota.
- Slug divalidasi sebagai huruf kecil, angka, dan satu tanda hubung, maksimal 40 karakter, serta unik per Organization lewat indeks unik di database.
- Migrasi `0005_projects.sql` juga memasang trigger `updatedAt`, dan tabel Service/Database pada tiket berikutnya akan memakai `ON DELETE CASCADE` ke Project.
- Jumlah Service dan Database masih nol karena tabelnya baru dibuat pada tiket 05 dan 11; ringkasan membaca angka sebenarnya, bukan placeholder.
- Aksi membuat, mengubah, dan menghapus Project mencatat AuditEvent (`project.created`, `project.updated`, `project.deleted`) dengan aktor dan detail Project.
