# Spec: Email transaksional (Resend + Mailjet)

Status: `ready-for-agent` — implementasi selesai, menunggu deploy & verifikasi.
Keputusan: [ADR-0014](../../docs/adr/0014-dual-email-providers.md).

## Tujuan

Platform Admin bisa mengatur kredensial Resend dan Mailjet, From address, kuota, dan prioritas lewat Admin Console → Settings, tanpa deploy ulang. Worker mengirim email dari outbox dengan failover otomatis.

## Ruang lingkup

- Tabel `email_provider` (1 baris per provider) + `email_outbox` (migrasi `0026`).
- `lib/platform/email-settings.ts` — kredensial terenkrip, kuota lokal, pemilih provider.
- `lib/platform/mailer.ts` — enqueue, deliver, retry, daftar outbox.
- API admin: GET/PUT providers, POST test, GET outbox, POST retry.
- Worker: `processOutboxBatch()` tiap 30 detik.
- Panel "Email providers" di `app/admin/settings/**` (features/admin tetap verbatim).

## Non-goal

- Webhook bounce/complaint, template email, integrasi ke alur auth (menyusul).
- Self-hosted SMTP server (port 25 diblokir di VPS).

## Kriteria selesai

- `npm run ci` hijau; tes email dengan provider API distub.
- Deploy produksi + health OK.
- Admin Console → Settings menampilkan panel Email providers; test email berhasil dikirim ke alamat terverifikasi provider.
