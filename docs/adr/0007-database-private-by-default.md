# Database private by default, public proxy opt-in

Database hanya dapat diakses dari Service di dalam Project yang sama secara default. Akses dari internet disediakan sebagai TCP proxy opt-in per Database dengan allowlist. Kami memilih ini agar default-nya aman tanpa menghilangkan kemampuan user menghubungkan aplikasi eksternal; konsekuensinya perlu ada layanan proxy, rate limit, dan audit akses.

> **Diperbarui oleh [ADR-0012](0012-shared-database-servers.md).** Default "private" tetap berlaku dan sekarang lebih ketat: Public Database Proxy dihapus untuk semua engine, karena satu listener pada server bersama akan mempublikasikan seluruh tenant. Bagian proxy di atas hanya berlaku untuk model per-Database yang lama.
