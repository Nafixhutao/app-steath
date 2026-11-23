# MySQL sebagai engine kedua, dengan phpMyAdmin

Supersedes [ADR-0006](0006-postgresql-only.md).

> **Sebagian besar keputusan di bawah sudah digantikan [ADR-0012](0012-shared-database-servers.md).** Database tidak lagi berupa container per Database, phpMyAdmin bukan lagi sidecar per Database, dan Public Database Proxy sudah tidak ada untuk engine apa pun. Yang masih berlaku: MySQL 8 sebagai engine kedua, engine terkunci saat provisioning, dan dump/restore per engine.

ADR-0006 memilih PostgreSQL saja supaya platform punya satu pola provisioning, satu jenis backup, dan satu jalur upgrade. Itu bertahan sampai ada kebutuhan nyata: aplikasi PHP dan panel admin berbasis MySQL tidak bisa memakai Database platform sama sekali, dan tidak semua pengguna mau memindahkan aplikasinya ke PostgreSQL hanya untuk hosting.

Keputusan ini menambah **MySQL 8** sebagai engine kedua yang dipilih saat provisioning:

- **Engine terkunci pada Database.** Direktori data, probe kesiapan, pernyataan rotasi password, dan alat dump berbeda antar engine. Konversi di tempat berarti menyalin seluruh data dengan risiko kehilangan, jadi engine tidak pernah berubah setelah Database dibuat. Mengganti engine = hapus lalu provisioning ulang, dan pilihan itu eksplisit di dashboard.
- **MySQL tidak memakai Public Database Proxy.** Proxy yang ada meneruskan stream TLS mentah dan mengandalkan PostgreSQL yang menegosiasikan TLS sendiri (ADR-0007). MySQL punya protokol dan negosiasi TLS sendiri, jadi proxy itu tidak bisa dipakai apa adanya. Alih-alih membangun proxy MySQL, setiap Database MySQL mendapat **phpMyAdmin** sebagai container pendamping di network Project yang sama — dijangkau lewat alias `db`, bukan port host, dan di-route pada Platform Domain seperti Platform Subdomain. Proxy publik karena itu ditolak dengan `409 database_proxy_unsupported` pada Database MySQL; phpMyAdmin adalah satu-satunya jalan masuk dari luar.

Konsekuensi yang diterima:

- Dua profil container, dua alat dump (`pg_dump` custom-format vs `mysqldump` plain SQL), dua pernyataan rotasi.
- Restore MySQL tidak bisa atomik: MySQL tidak punya `RENAME DATABASE`, jadi dump divalidasi dulu di database sementara, lalu diterapkan ke database asli. Restore PostgreSQL tetap atomik seperti sebelumnya.
- phpMyAdmin adalah container tambahan per Database MySQL (0.25 CPU, 256 MB), dan satu-satunya container platform yang mendapat capability (`CHOWN`, `DAC_OVERRIDE`, `NET_BIND_SERVICE`, `SETGID`, `SETUID`) karena Apache bind port 80 lalu turun ke `www-data`.
