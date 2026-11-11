# 14: Dashboard Quota dan penggunaan

**What to build:** Anggota Organization dapat melihat Quota Organization dan pemakaian resource. API menolak pembuatan resource yang melewati batas dengan pesan yang menyebut batas dan pemakaian saat ini.

**Blocked by:** 05, 10, 11

**Status:** ready-for-human

- [x] Dashboard menampilkan batas Project, Service per Project, Service per Organization, Database per Project, CPU, RAM, Volume, storage Database, Build concurrency, dan retensi log.
- [x] Pemakaian CPU, RAM, Volume, dan Database diperbarui setiap lima menit dan saat halaman dibuka.
- [x] Pembuatan resource yang melewati Quota mengembalikan status 409 dengan batas dan pemakaian saat ini.
- [x] Member dapat melihat Quota; owner/admin dapat melihat detail limit.
- [x] Quota yang diturunkan tidak menghapus resource yang sudah ada.
- [x] Bandwidth tidak diukur dan tidak ditampilkan sebagai Quota.
- [x] Tes API mencakup setiap jenis penolakan Quota dan perhitungan pemakaian.
