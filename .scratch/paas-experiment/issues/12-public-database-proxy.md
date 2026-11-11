# 12: Public Database Proxy

**What to build:** Owner/admin dapat mengaktifkan Public Database Proxy per Database secara opt-in, mengatur allowlist CIDR, dan terhubung dari luar memakai TLS. Menonaktifkan proxy langsung mencabut endpoint publik.

**Blocked by:** 11

**Status:** ready-for-agent

- [ ] Public Database Proxy nonaktif secara default dan tidak ada endpoint publik saat Database dibuat.
- [ ] Mengaktifkan proxy mewajibkan minimal satu allowlist CIDR.
- [ ] Proxy berjalan dengan TLS dan port unik pada rentang 20000-29999.
- [ ] Hanya IP dalam allowlist yang dapat terhubung; IP lain ditolak.
- [ ] Connection string publik ditampilkan saat proxy aktif.
- [ ] Menonaktifkan proxy menghentikan listener dan mencabut endpoint.
- [ ] Enable/disable proxy dicatat sebagai AuditEvent.
- [ ] Tes Node Agent mencakup allowlist, TLS, dan pencabutan endpoint.
