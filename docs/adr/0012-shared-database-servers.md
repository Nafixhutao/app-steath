# Satu server database bersama per engine

Supersedes [ADR-0006](0006-postgresql-only.md) dan [ADR-0011](0011-mysql-with-phpmyadmin.md); mengubah [ADR-0007](0007-database-private-by-default.md).

Tier ini gratis, jadi setiap Database tidak boleh mendapat container sendiri. Model sebelumnya memberi tiap Database satu container, satu Volume, dan satu network sendiri — untuk PostgreSQL, ditambah lagi satu container nginx untuk proxy dan satu container phpMyAdmin untuk MySQL. Satu node dengan beberapa Project langsung menghabiskan RAM sebelum ada yang benar-benar dipakai, dan biaya per Database membuat tier gratis tidak mungkin dipertahankan.

Keputusan ini mengubah Database menjadi **schema di dalam satu server bersama per engine**:

- **Satu server per engine, untuk seluruh node.** Ada satu `stealth-pgdb` (PostgreSQL 16) dan satu `stealth-mysql` (MySQL 8.4). Keduanya hidup di network `stealth_default`, punya Volume sendiri, dan dipasang ke network setiap Project yang punya Database dengan alias `db`. Satu Database = satu schema dan satu role di dalam server itu; tidak ada container, Volume, atau network per Database.
- **Nama schema dan role diturunkan dari id.** `databaseObjectNames(id)` menghasilkan `db_<24 karakter>` dan `u_<24 karakter>`, di mana 24 karakter itu adalah id tanpa tanda hubung. Batas 24 dipilih karena MySQL membatasi nama user 32 karakter. Control Plane dan Node Agent memakai rumus yang sama, jadi keduanya selalu menunjuk objek yang sama tanpa perlu saling bertanya.
- **Isolasi lewat grant, bukan lewat container.** Role hanya mendapat hak atas schema miliknya sendiri, jadi Database lain di server yang sama tidak terbaca. PostgreSQL memakai `REVOKE ALL ON DATABASE ... FROM PUBLIC`; MySQL memakai `GRANT ... ON <schema>.*`.
- **Public Database Proxy dihentikan untuk semua engine.** Satu listener TCP meneruskan ke satu port yang melayani semua tenant, jadi mustahil mempublikasikan satu Database tanpa ikut mempublikasikan yang lain. Endpoint-nya kini selalu `409 database_proxy_unsupported`, dan listener sisa dari model lama dibongkar. Akses dari luar hanya lewat Service di Project yang sama.
- **phpMyAdmin menjadi satu container untuk seluruh node** (`stealth-pma`, alias `pma`), bukan sidecar per Database. Semua Database MySQL masuk lewat alamat yang sama dengan kredensial masing-masing.
- **Kuota ditegakkan dengan mengunci role**, bukan dengan menghentikan container — karena tidak ada container untuk dihentikan. Melewati batas storage membuat role di-`Acount LOCK` (MySQL) atau `NOLOGIN` (PostgreSQL).
- **Control Plane tetap punya databasenya sendiri.** `stealth-postgres` tidak dipakai ulang sebagai server tenant; kalau dipakai, database internal platform akan menempel di network setiap Project.

Konsekuensi yang diterima:

- Satu Database yang boros bisa mengganggu tetangganya di server yang sama. Batas storage ditegakkan per schema, tetapi CPU dan memori server dipakai bersama.
- Backup dan restore berjalan per schema di dalam server bersama, bukan per container: `mysqldump` dengan `--single-transaction --no-tablespaces` untuk MySQL, `pg_dump` custom-format untuk PostgreSQL. Restore MySQL tetap tidak atomik karena MySQL tidak punya `RENAME DATABASE`.
- Menghapus Database hanya menghapus schema dan role-nya; servernya tetap hidup untuk tenant lain.
- Tidak ada lagi jalur masuk dari internet. Ini pengetatan yang disengaja: proxy sebelumnya adalah satu-satunya alasan container per Database ada, dan mempertahankannya berarti mempertahankan biaya yang ingin dihapus.
