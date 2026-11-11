# 17: Pemindaian image dan temuan admin

**What to build:** Setiap image hasil Build dipindai dengan Trivy dan ClamAV. Temuan disimpan sebagai ScanFinding dan dapat dilihat Platform Admin lintas Organization tanpa mengakses secret user.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] Setiap Build sukses dipindai dengan Trivy untuk vulnerability, secret, dan misconfiguration.
- [ ] Setiap Build sukses dipindai dengan ClamAV untuk malware pada filesystem image.
- [ ] ScanFinding menyimpan scanner, severity, title, details, dan Deployment terkait.
- [ ] Platform Admin ditentukan oleh daftar email di environment dan dapat melihat temuan lintas Organization.
- [ ] Temuan malware severity tinggi ditandai urgent, tetapi tidak otomatis menangguhkan Service.
- [ ] Platform Admin tidak dapat melihat nilai Environment Variable rahasia atau password Database.
- [ ] Tes mencakup pemindaian fixture rentan dan akses temuan oleh Platform Admin.
