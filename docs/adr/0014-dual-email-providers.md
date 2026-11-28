# Email transaksional: dua provider dengan outbox

Customer memerlukan email transaksional (verifikasi, reset password, notifikasi). Self-hosted MTA tidak memungkinkan di VPS ini: port 25 outbound diblokir provider dan PTR/MX/DKIM/DMARC belum ada, jadi pengiriman langsung ke MX pihak ketiga tidak bisa diandalkan (lihat diskusi tim 25 Nov 2026). Kami memilih **provider email transaksional**, dengan **Resend sebagai primary** dan **Mailjet sebagai fallback**, dikonfigurasi dari Admin Console → Settings.

Kedua provider punya free tier permanen: Resend 3.000 email/bulan (100/hari), Mailjet 6.000 email/bulan (200/hari). Worker menghitung pemakaian lokal per provider dan memindahkan pengiriman ke provider berikutnya ketika kuota lokal habis atau provider menjawab 429 — total ~9.000 email/bulan tanpa biaya.

Setiap email ditulis ke tabel `email_outbox` sebelum dipanggil ke provider. Worker mengambil baris dengan `FOR UPDATE SKIP LOCKED`, memakai id baris sebagai **Idempotency-Key** di Resend dan **CustomID** di Mailjet, lalu mencatat hasilnya. Dengan demikian crash, timeout, atau failover tidak mengirim email yang sama dua kali. Kredensial dienkrip dengan `ENV_ENCRYPTION_KEY` dan tidak pernah dikembalikan oleh API.

Konsekuensi yang diterima:

- Admin Console konfigurasi email berada di `app/admin/settings/**` dan mengimpor primitive `features/admin/**`; file Forge tetap verbatim (ADR-0008). Tidak ada item navigasi baru di sidebar — panel muncul di halaman Settings yang sudah ada.
- DNS wajib: satu record SPF yang meng-include kedua provider, dua selector DKIM, dan satu DMARC yang selaras dengan `From:`. Dua record SPF akan membuat `PermError`.
- Kuota lokal adalah perkiraan; provider tetap menjadi sumber kebenaran. Jika provider mengubah batas, admin bisa mengubah angka di panel tanpa deploy.
- Message yang gagal setelah 5 percobaan berstatus `failed` dan bisa dicoba ulang dari panel. Tidak ada webhook bounce/complaint pada iterasi ini.
- Template email belum terhubung ke alur Better Auth; iterasi berikutnya akan memakai `enqueueEmail()` dari alur verifikasi/reset password.
