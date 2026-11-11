# 13: Custom Domain dan TLS

**What to build:** Owner/admin dapat menambahkan satu Custom Domain per Service, memverifikasi kepemilikan lewat TXT, mengarahkan DNS ke VPS, dan mendapatkan HTTPS otomatis. Platform Subdomain tetap berfungsi jika Custom Domain gagal.

**Blocked by:** 07

**Status:** ready-for-human

- [x] Custom Domain dapat ditambahkan dengan hostname unik dan maksimal satu per Service.
- [x] Dashboard menampilkan instruksi TXT `_stealth-verify` dan A/CNAME ke VPS.
- [x] Platform memverifikasi TXT dan resolusi DNS sebelum menandai domain `active`.
- [x] Caddy hanya menerbitkan sertifikat untuk hostname yang terdaftar dan aktif.
- [x] Custom Domain aktif melayani HTTPS dan merutekan ke Service yang benar.
- [x] Verifikasi gagal tidak menghentikan Platform Subdomain.
- [x] Menghapus Custom Domain menghapus route dan status sertifikat.
- [x] Tes mencakup verifikasi, konflik hostname, dan kegagalan verifikasi.
