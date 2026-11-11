# 13: Custom Domain dan TLS

**What to build:** Owner/admin dapat menambahkan satu Custom Domain per Service, memverifikasi kepemilikan lewat TXT, mengarahkan DNS ke VPS, dan mendapatkan HTTPS otomatis. Platform Subdomain tetap berfungsi jika Custom Domain gagal.

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] Custom Domain dapat ditambahkan dengan hostname unik dan maksimal satu per Service.
- [ ] Dashboard menampilkan instruksi TXT `_stealth-verify` dan A/CNAME ke VPS.
- [ ] Platform memverifikasi TXT dan resolusi DNS sebelum menandai domain `active`.
- [ ] Caddy hanya menerbitkan sertifikat untuk hostname yang terdaftar dan aktif.
- [ ] Custom Domain aktif melayani HTTPS dan merutekan ke Service yang benar.
- [ ] Verifikasi gagal tidak menghentikan Platform Subdomain.
- [ ] Menghapus Custom Domain menghapus route dan status sertifikat.
- [ ] Tes mencakup verifikasi, konflik hostname, dan kegagalan verifikasi.
