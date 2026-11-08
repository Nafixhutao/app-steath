# 05: Konfigurasi Service dan alamat platform

**What to build:** Owner/admin dapat membuat Service dari URL repository publik dengan branch, Dockerfile path, port, dan health path. Service memiliki Platform Subdomain unik dan tampil di halaman Project, meskipun belum dijalankan.

**Blocked by:** 04

**Status:** ready-for-human

- [x] Create Service memvalidasi URL HTTPS publik, branch, Dockerfile path, port, dan health path.
- [x] Platform Subdomain `<service-slug>-<short-id>.<platform-suffix>` dibuat unik dan ditampilkan.
- [x] List/detail Service menampilkan status not deployed, URL, dan batas resource.
- [x] Service kedua dalam Project dan Service keenam dalam Organization ditolak dengan error Quota.
- [x] Owner/admin dapat menghapus Service dengan konfirmasi.
- [x] Member hanya dapat melihat.
- [x] Tes API mencakup validasi, Quota, isolasi tenant, dan pembuatan subdomain.

Implementasi dan verifikasi otomatis selesai: `npm run typecheck`, `npm run lint`, `npm test` (6 file, 37 tes), dan `npm run build` lulus.

Verifikasi browser (agent-browser) mencakup: pembuatan Service dari Project dengan konfigurasi lengkap, penolakan repository `http://`, tampilan Platform Subdomain, status `Not Deployed`, batas resource 0,5 vCPU dan 512 MB, halaman detail Service dengan breadcrumb Project yang benar, penghitung Service pada halaman Project dan Overview yang ikut berubah, penolakan Service ketiga dengan 409, delete Service dengan konfirmasi nama, tampilan read-only untuk member, dan isolasi tenant (Organization lain mendapat 404).

Catatan implementasi:

- Migrasi `0006_services.sql` menyimpan konfigurasi Service dengan `ON DELETE CASCADE` ke Project, indeks unik global pada `platformHostname`, dan trigger `updatedAt`.
- Platform Subdomain dibentuk oleh `buildPlatformHostname` di `lib/platform/platform-domain.ts` memakai suffix dari `PLATFORM_DOMAIN` (fallback `localhost` untuk pengembangan, `<ip-vps>.nip.io` untuk percobaan). `short-id` enam karakter acak; tabrakan hostname diulang dengan id baru.
- Quota Service ditegakkan dua kali di dalam satu transaksi: dua per Project dan lima per Organization, memakai advisory lock per Organization agar request bersamaan tidak melampaui batas. Error Quota tetap berstatus 409 dan menyebut batas serta pemakaian.
- Validasi menolak URL non-HTTPS, URL dengan kredensial, host lokal, branch dengan `..`, Dockerfile path absolut atau keluar direktori, port di luar 1–65535, dan health path tanpa `/`.
- `serviceCount` pada ringkasan Project kini membaca tabel Service, sehingga daftar Project, detail Project, dan Overview menampilkan angka nyata dan status `Active` saat Service ada.
- API: `GET/POST /api/projects/[projectId]/services`, `GET/DELETE /api/services/[serviceId]`, dan `GET /api/services` untuk daftar Service satu Organization. Rute daftar membaca header di luar blok `try` agar Next membatalkan prerender tanpa menelan sinyal bailout.
- Aksi membuat dan menghapus Service mencatat AuditEvent `service.created` dan `service.deleted` dengan aktor, `projectId`, `serviceId`, dan Platform Subdomain.
- Status Service disimpan sebagai `not_deployed`; Deployment pada tiket 06 dan 07 yang akan mengubahnya menjadi `building`, `running`, dan seterusnya.
