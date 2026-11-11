# 19: E2E smoke test dan deploy VPS

**What to build:** Seluruh platform dapat dijalankan pada satu VPS dengan Docker Compose, Caddy, migrasi, dan konfigurasi environment. Smoke test membuktikan alur signup sampai Service dan Database berjalan, lalu membersihkan resource.

**Blocked by:** 01-18 (semua tiket sebelumnya)

**Status:** ready-for-agent

- [ ] Docker Compose menjalankan Control Plane, worker, Node Agent, Caddy, dan PostgreSQL platform.
- [ ] Node Agent tidak diekspos ke internet dan memakai token; Control Plane tidak memegang Docker socket.
- [ ] Migrasi database berjalan dengan advisory lock dan service menunggu Control Plane siap.
- [ ] Health endpoint Control Plane dan Node Agent berfungsi.
- [ ] Restart Control Plane tidak menghentikan Service user; restart Node Agent merekonsiliasi container dan route.
- [ ] Smoke test berjalan: signup -> Organization -> Project -> Service -> Deployment -> URL HTTPS -> Database -> koneksi dari Service -> Public Database Proxy -> cleanup.
- [ ] Custom Domain diuji di environment yang memiliki DNS; jika tidak tersedia, verifikasi route diuji di Node Agent.
- [ ] Runbook VPS mencakup setup Docker, Caddy, environment, backup, dan troubleshooting.
- [ ] Semua test Control Plane, Node Agent, dan smoke test lulus.

## Comments

### E2E smoke test — lulus via Cloudflare quick tunnel (11 Nov 2026)

Deploy penuh di `ubuntu@31.56.56.126` (`/home/ubuntu/paas`), image
`stealth-app:local` + `stealth-agent:local` dibuild langsung di VPS. Alur yang
dijalankan lewat browser (agent-browser) pada
`https://<quick-tunnel>.trycloudflare.com`:

signup `e2e.owner@example.com` → Organization (otomatis) → Project `E2E Demo` →
Service `web` (repo `docker/welcome-to-docker`, port 3000) → Deploy **running** →
URL HTTPS 200 lewat Caddy (`web-boelny.apps.nazxf.my.id`, route reverse-proxy
`svc-...:3000`) → Database PostgreSQL 16 `app@app` (hostname `db:5432`) →
koneksi TCP dari Service ke `db:5432` OK + `DATABASE_URL` terinject setelah
redeploy → Public Database Proxy aktif di port **24382**, terbukti `psql
app@app` via TLS dari localhost/`--network host` → cleanup semua resource (tabel
DB 0, route Caddy `[]`).

**Temuan yang diperbaiki selama smoke test:**

1. `.dockerignore` `*.png` menendang `public/stealth-cat.png` +
   `kurama-avatar.png` dari image → logo 404 + optimizer `EACCES`. Dihapus.
2. `.next` di-`COPY --chown=nextjs:nodejs` agar `next image` bisa menulis
   `cache/images` (sebelumnya `EACCES: mkdir '/app/.next/cache/images'`).
3. `backups_data` Volume + `BACKUP_LOCAL_DIR=/app/backups` (worker tulis, CP
   baca) — sebelumnya backup gagal `EACCES mkdir /app/backups`.
4. Worker `depends_on: agent` — backup harian yang jalan sebelum agent siap
   gagal `fetch failed`.
5. `init: true` (tini ganda) dihapus dari service agent.
6. Backup platform end-to-end **completed** (75 KB, `storageProvider=local`).

**Temuan yang dicatat sebagai follow-up (bukan blocker):**

- Hapus Service/Project tidak menghapus image `stealth/service-*` dan network
  `stealth-project-*` → ticket **20**.
- Public DB Proxy tidak terjangkau dari internet karena VPS di belakang NAT
  provider (IP publik `31.56.56.126` → lokal `192.168.31.222`); hanya port SSH
  yang diteruskan. Port proxy bekerja penuh dari dalam. UFW sudah dibuka
  `20000:29999/tcp`. Dicatat di `docs/deployment/vps.md` §9.

### Ingress permanen — LIVE (11 Nov 2026)

- Domain utama beralih dari quick tunnel ke **`https://console.nazxf.my.id`**.
  `GET /api/health` = 200, logo `/stealth-cat.png` + `/_next/image` +
  `/kurama-avatar.png` semuanya 200 `image/png`.
- Tunnel lama (`19691b9a` "app-steatlh" dan `ea960b8e` "stealth-052ea945a0e6")
  sudah terhapus di dashboard, jadi dibuat tunnel baru via API Cloudflare:
  **`app-stealth-prod`** (id `d832d1c5-48a3-4a94-8eab-e2a5bfd050bf`), token-managed.
- Ingress tunnel: `console.nazxf.my.id` → `http://control-plane:3000`,
  `*.apps.nazxf.my.id` → `https://caddy:443` (No TLS Verify).
- DNS `console.nazxf.my.id` dan `*.apps.nazxf.my.id` CNAME (proxied) ke
  `d832d1c5-…cfargotunnel.com`. Apex/nama lain milik proyek lain tidak disinggung.
- `CLOUDFLARE_TUNNEL_TOKEN` di `.env` VPS dirotasi ke tunnel baru, `cloudflared`
  recreate (4 koneksi QUIC), `stealth-quicktunnel` dihapus.

**Belum selesai:**

- SSH hardening VPS ditunda oleh user.
