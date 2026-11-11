# Deploy ke satu VPS

Runbook ini memasang seluruh platform di satu VPS dengan Docker Compose dan
Cloudflare Tunnel. Tidak ada port publik yang dibuka: satu-satunya jalan masuk
adalah tunnel, dan satu-satunya proses yang memegang Docker socket adalah Node
Agent.

## Bentuk deployment

```
Cloudflare (TLS publik)
   |
   | tunnel
   v
cloudflared ---> http://control-plane:3000      (console.<domain>)
   |
   +-----------> https://caddy:443               (*.<platform-domain>)

Compose network (internal):
  postgres  control-plane  worker  agent  caddy
                                    |
                                    +- /var/run/docker.sock
```

- `migrate` jalan sekali per `up`, mengambil advisory lock PostgreSQL, lalu
  keluar. `control-plane` dan `worker` menunggu `service_completed_successfully`.
- Control Plane **tidak** memegang Docker socket. Ia memanggil Node Agent lewat
  `http://agent:8081` dengan bearer token.
- Caddy tidak punya site block di Caddyfile. Node Agent membuat server `:443`
  lewat admin API dan menulis ulang route setiap Deploy. Karena Caddy menolak dua
  server pada listener yang sama, dashboard tidak lewat Caddy: tunnel
  mengarahkannya langsung ke Control Plane.

## 1. Prasyarat di VPS

Ubuntu 22.04/24.04, Docker 27+, Compose v2.20+ (butuh
`service_completed_successfully`).

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
newgrp docker
docker compose version
```

### Public Database Proxy (port 20000-29999)

Ketika pengguna mengaktifkan "Public proxy" pada sebuah Database, Node Agent
memublikasikan port TCP dari rentang **20000–29999** (lihat
`DatabaseProxyPortMin`/`Max` di `agent/internal/runtime/proxies.go`). Port ini
adalah satu-satunya lalu lintas TCP yang harus lolos firewall untuk fitur proxy:

```bash
sudo ufw allow 20000:29999/tcp
```

Tanpa aturan ini (dengan UFW policy default `deny`), koneksi proxy ditolak
meskipun portnya ter-`docker-proxy`. Lihat juga catatan NAT di §9.

## 2. Kode dan env

```bash
mkdir -p /home/ubuntu/paas
cd /home/ubuntu/paas
# salin repo (git clone, rsync, atau scp)
```

Salin `.env.production` ke `/home/ubuntu/paas/.env`:

```bash
scp -P <port> .env.production <user>@<vps>:/home/ubuntu/paas/.env
chmod 600 /home/ubuntu/paas/.env
```

`.env` wajib berisi minimal:

| Key | Contoh |
| --- | --- |
| `DATABASE_URL` | `postgresql://stealth:<password>@postgres:5432/stealth_hosting` |
| `POSTGRES_PASSWORD` | password yang sama dengan di `DATABASE_URL` |
| `BETTER_AUTH_SECRET` | 32+ karakter acak |
| `BETTER_AUTH_URL` | `https://console.<domain>` |
| `NEXT_PUBLIC_BETTER_AUTH_URL` | sama; **di-inline saat build** |
| `ENV_ENCRYPTION_KEY` | 32 byte base64 atau 64 hex |
| `AGENT_TOKEN` | token acak |
| `AGENT_BASE_URL` | `http://agent:8081` |
| `PLATFORM_DOMAIN` | `apps.<domain>` |
| `CLOUDFLARE_TUNNEL_TOKEN` | dari dashboard Cloudflare |

`scripts/wizard-vps.sh` membuat nilai acak dan menulis `.env.production`.

> `NEXT_PUBLIC_BETTER_AUTH_URL` masuk ke bundle browser saat `docker build`.
> Kalau domain berubah, image harus di-build ulang:
> `docker compose -f docker-compose.production.yml build --no-cache control-plane`.

## 3. Cloudflare Tunnel

1. Cloudflare Zero Trust -> **Networks -> Tunnels -> Create a tunnel** -> pilih
   **Cloudflared** -> beri nama (mis. `paas`).
2. Salin **token** dari halaman install. Token ini mengisi
   `CLOUDFLARE_TUNNEL_TOKEN`.
3. Di tab **Public Hostname**, tambahkan dua entri:

| Subdomain | Domain | Path | Service |
| --- | --- | --- | --- |
| `console` | `<domain>` | - | `http://control-plane:3000` |
| `*` | `apps.<domain>` | - | `https://caddy:443` |

Untuk entri wildcard, buka **Additional application settings -> TLS** dan aktifkan
**No TLS Verify** (Caddy memakai CA internal, bukan sertifikat publik).

Cloudflare membuat CNAME `console` dan `*.apps` otomatis. Tidak ada A record ke
IP VPS, jadi port 80/443 di VPS tetap tertutup.

## 4. Jalankan

```bash
cd /home/ubuntu/paas
docker compose -f docker-compose.production.yml up -d --build
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs -f control-plane
```

Cek kesehatan:

```bash
docker compose -f docker-compose.production.yml exec -T control-plane \
  node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{console.log(r.status,await r.text())})"
```

Harapan: `200 {"status":"ok","database":"ok","migrations":"ok"}`.

Lalu buka `https://console.<domain>`.

## 5. Health endpoint

| Proses | Endpoint | Catatan |
| --- | --- | --- |
| Control Plane | `GET /api/health` | cek DB + tabel migrasi; 503 kalau gagal |
| Node Agent | `GET /v1/health` | butuh `Authorization: Bearer $AGENT_TOKEN` |

```bash
docker compose -f docker-compose.production.yml exec -T control-plane \
  node -e "fetch('http://agent:8081/v1/health',{headers:{authorization:'Bearer '+process.env.AGENT_TOKEN}}).then(async r=>console.log(r.status,await r.text()))"
```

## 6. Restart

| Aksi | Harapan |
| --- | --- |
| `docker compose restart control-plane` | Service user tetap jalan (container-nya tidak dikelola Control Plane) |
| `docker compose restart agent` | Agent menjalankan `Reconcile`: container yang bertahan mendapat network alias dan route Caddy-nya kembali |

Agent juga menjalankan housekeeping saat start (container/image/volume yatim dan
prune cache build mingguan) setelah Reconcile selesai.

## 7. Troubleshooting

| Gejala | Penyebab umum |
| --- | --- |
| `migrate` exit 1 `ENOENT /app/database/migrations` | Image dibuild tanpa folder `database/` |
| Logo rusak (404 `/stealth-cat.png` / `/_next/image` `EACCES`) | Asset PNG tertendang `.dockerignore`, atau `.next` tidak di-`chown` ke user runtime |
| Backup `EACCES: permission denied, mkdir '/app/backups'` | `BACKUP_LOCAL_DIR` tidak diisi, atau Volume `backups_data` tidak dipasang di `worker`/`control-plane` |
| Backup `fetch failed` | Worker menjalankan backup harian sebelum Agent siap; Agent harus naik lebih dulu |
| Health `503 database: unavailable` | `DATABASE_URL` salah, atau `postgres` belum healthy |
| Health `503 migrations: missing` | `migrate` tidak selesai; cek `logs migrate` |
| Dashboard 502 di Cloudflare | Ingress menunjuk `caddy:443`, bukan `control-plane:3000` |
| Service user 502 | Ingress wildcard belum **No TLS Verify**, atau route Caddy belum dibuat (agent down) |
| Sertifikat Caddy gagal | `local_certs` hilang dari Caddyfile produksi |
| `listener address repeated: tcp/:443` | Caddyfile punya site block; dashboard harus lewat tunnel langsung |
| Agent tidak bisa `docker` | Socket tidak di-mount, atau user container tidak punya akses grup docker |

### X-Real-IP / X-Forwarded-For

Caddy wajib **menimpa** `X-Real-IP` dan `X-Forwarded-For` dengan alamat peer
sebenarnya, bukan meneruskan header dari klien. Tanpa itu, rate limit dan audit
mencatat IP palsu yang dikirim klien. Ini sempat jadi bug (commit `392689f`);
kalau route ditulis ulang, pastikan perilaku ini tetap ada.

## 8. Backup

Backup platform berjalan dari worker lewat Node Agent. Tanpa `S3_*`, hasilnya
disimpan di Volume `stealth_backups_data` yang dipasang di `/app/backups` pada
`worker` dan `control-plane` (worker menulis, Control Plane membacanya untuk
unduhan). Jangan hapus Volume itu selama Backup masih dibutuhkan.

Untuk produksi, isi `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
dan `S3_SECRET_ACCESS_KEY` (RustFS/MinIO atau S3 lain).

`PLATFORM_DB_CONTAINER` harus sama dengan `container_name` PostgreSQL
(`stealth-postgres`), karena agent menjalankan `pg_dump` lewat `docker exec`.

## 9. Batasan yang diketahui

- Custom Domain dengan Cloudflare proxy: verifikasi `PLATFORM_IP` membandingkan A
  record dengan IP VPS, sedangkan domain yang di-proxy Cloudflare menunjuk IP
  Cloudflare. Untuk menguji Custom Domain, gunakan record **DNS only** (grey
  cloud) atau lewati uji ini.
- **VPS di belakang NAT provider**: pada mesin yang IP publiknya di-NAT
  (mis. IP publik luar → `192.168.x.x` lokal), hanya port tertentu yang
  diteruskan provider (biasanya SSH). Port publik Database proxy
  (20000–29999) **tidak** dapat dijangkau dari internet, walau `docker-proxy`
  mendengarkan dan UFW sudah mengizinkan. Proxy tetap berfungsi dari dalam
  (localhost / `--network host`) — minta provider meneruskan rentang tersebut,
  atau arahkan proxy lewat tunnel bila dibutuhkan secara publik.
- ClamAV tidak dibundel di image agent (database virus butuh ~1 GB RAM/disk).
  Scanner melaporkan ketiadaannya sebagai temuan informasional, bukan kegagalan.
