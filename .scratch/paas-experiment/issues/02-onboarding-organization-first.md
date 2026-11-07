# 02: Onboarding Organization-first

**What to build:** User baru dapat signup dan langsung masuk ke Organization pribadi sebagai owner. Dashboard menampilkan Organization switcher dan navigasi hosting; seluruh resource berikutnya terikat ke Organization aktif.

**Blocked by:** 01

**Status:** ready-for-human

- [x] Signup membuat User, Organization pribadi, dan owner membership dalam satu transaksi.
- [x] Session menyimpan Organization aktif dan switcher mengganti konteks.
- [x] User dapat membuat Organization tambahan.
- [x] Dashboard memakai navigasi hosting, bukan sidebar template generik.
- [x] User tidak dapat membaca data Organization lain.
- [x] Tes API mencakup signup, default Organization, switch, dan isolasi tenant.

Implementasi dan verifikasi otomatis selesai. Verifikasi visual melalui browser mencakup desktop, switcher, pembuatan Organization, dan drawer mobile; perubahan siap ditinjau manusia.
