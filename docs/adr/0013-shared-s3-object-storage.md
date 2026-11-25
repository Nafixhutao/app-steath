# Object storage S3 self-hosted di satu server MinIO bersama

Customer perlu penyimpanan objek yang kompatibel S3: bucket per Project, Access Key/Secret Key untuk dipakai aplikasi customer lewat AWS SDK, URL publik untuk bucket Public, dan kuota. Kami memilih **MinIO** di satu VPS ini, dengan **satu server bersama** untuk seluruh tenant, bukan satu container per bucket. Karena image komunitas MinIO ditarik dari registry publik pada 2026, server yang dipakai adalah fork komunitas `pgsty/silo` (kompatibel dengan S3 API, variabel `MINIO_*`, dan format data); client `mc` dipakai dari rilis MinIO terakhir yang masih tersedia.

Isolasi tidak berada di container melainkan di dalam MinIO: setiap Bucket mendapat nama fisik turunan id, user IAM, policy yang hanya mencakup bucket itu, dan kuota hard. Control Plane menyimpan nama, Access Key, dan Secret Key yang dienkrip; Node Agent — satu-satunya proses yang memegang Docker socket — membuat dan menghapus objek, user, policy, serta memasang rute Caddy untuk endpoint `s3.<Platform Domain>` (path-style). Ini mengikuti pola [ADR-0012](0012-shared-database-servers.md): container per tenant menghabiskan RAM dan mustahil dipertahankan di tier gratis.

Konsekuensi yang diterima:

- MinIO berjalan sebagai service platform di Compose, bukan container yang dibuat Agent per Project. Jika server mati, semua bucket ikut mati — tetapi Agent dapat memulainya kembali tanpa kehilangan data berkat Volume `minio_data`.
- Endpoint memakai **path-style** (`https://s3.<domain>/<bucket>/<key>`), sehingga tidak memerlukan DNS wildcard tambahan di luar ingress `*.<platform-domain>` yang sudah ada. SDK customer wajib mengaktifkan `forcePathStyle: true`.
- Kuota storage ditegakkan oleh MinIO per bucket, bukan dengan menghitung byte di dashboard; pemakaian yang ditampilkan bersifat informatif.
- Secret Key dienkrip dengan `ENV_ENCRYPTION_KEY` dan hanya dikembalikan lewat endpoint reveal untuk owner/admin; tidak pernah masuk payload daftar bucket, log, atau audit event.
- Cloudflare edge membatasi ukuran satu request HTTP (sekitar 100 MB pada paket Free), jadi unggahan besar harus multipart. Ini batas jaringan, bukan batas MinIO.
