# 12: Public Database Proxy

**What to build:** Owner/admin dapat mengaktifkan Public Database Proxy per Database secara opt-in, mengatur allowlist CIDR, dan terhubung dari luar memakai TLS. Menonaktifkan proxy langsung mencabut endpoint publik.

**Blocked by:** 11

**Status:** ready-for-human

- [x] Public Database Proxy nonaktif secara default dan tidak ada endpoint publik saat Database dibuat.
- [x] Mengaktifkan proxy mewajibkan minimal satu allowlist CIDR.
- [x] Proxy berjalan dengan TLS dan port unik pada rentang 20000-29999.
- [x] Hanya IP dalam allowlist yang dapat terhubung; IP lain ditolak.
- [x] Connection string publik ditampilkan saat proxy aktif.
- [x] Menonaktifkan proxy menghentikan listener dan mencabut endpoint.
- [x] Enable/disable proxy dicatat sebagai AuditEvent.
- [x] Tes Node Agent mencakup allowlist, TLS, dan pencabutan endpoint.
