# Stealth Hosting

Platform PaaS untuk men-deploy aplikasi dari repository dan menyediakan database, dijalankan sebagai SaaS publik dengan model organisasi.

## Language

### Tenancy

**User**:
Orang yang terautentikasi di platform. Satu User dapat menjadi Member di beberapa Organization.
_Avoid_: Account, customer

**Organization**:
Batas kepemilikan (tenant) tempat anggota bekerja sama; memiliki Project dan kuota.
_Avoid_: Tenant, workspace, account

**Member**:
User yang tergabung dalam sebuah Organization.
_Avoid_: Participant, seat

**Role**:
Peran yang menentukan izin seorang Member di dalam Organization.
_Avoid_: Permission level, rank

**Platform Admin**:
Akun admin-only dengan akses lintas Organization untuk menangani abuse, Suspension, dan operasi platform; tidak memiliki Organization dan tidak memakai dashboard user.
_Avoid_: Superadmin, root, admin user

**Admin Console**:
Permukaan lintas Organization untuk Platform Admin — overview, infrastructure, logs, traces, errors, runs, workers, incidents, users, providers, usage, status, settings, plus Scan Findings dan Abuse Report.
_Avoid_: Dashboard admin, panel admin

### Delivery

**Project**:
Unit kerja di dalam Organization yang mengelompokkan Service dan paling banyak satu Database untuk satu aplikasi.
_Avoid_: App, workspace

**Service**:
Unit yang dapat di-deploy secara terpisah di dalam sebuah Project; berjalan sebagai satu container dan memiliki paling banyak satu Volume.
_Avoid_: Website, site, app

**Deployment**:
Satu percobaan membangun dan menjalankan versi sebuah Service.
_Avoid_: Release, roll-out

**Build**:
Proses mengubah repository menjadi image container untuk sebuah Deployment.
_Avoid_: Compile, pipeline

**Volume**:
Penyimpanan persisten yang dipasang ke satu Service.
_Avoid_: Disk, storage

**Bucket**:
Wadah objek S3 untuk sebuah Project, dibuat dengan satu Access Key dan Secret Key serta kuota hard. Bukan container: ia adalah bucket, user IAM, dan policy di dalam server MinIO bersama di node. Bisa Public (baca anonim) atau Private.
_Avoid_: Storage, folder, object

**Environment Variable**:
Nilai konfigurasi yang disuntikkan ke Service saat runtime.
_Avoid_: Env, config

**Database**:
Database yang disediakan platform untuk sebuah Project; paling banyak satu per Project. Sebuah Database bukan container: ia adalah satu schema dan satu role di dalam server bersama milik engine-nya. Engine dipilih saat provisioning dan tidak bisa diganti di tempat: PostgreSQL 16, atau MySQL 8.
_Avoid_: DB

**Database Engine**:
PostgreSQL 16 atau MySQL 8. Menentukan server bersama mana yang menyimpan Database, pernyataan rotasi password, dan alat dump, sehingga terkunci pada Database yang sudah ada.

**Shared Database Server**:
Satu container per engine untuk seluruh node (`stealth-pgdb`, `stealth-mysql`). Setiap Project yang punya Database dipasangkan ke network-nya dengan alias `db`, dan isolasi antar Database dijaga oleh grant atas schema, bukan oleh container.
_Avoid_: Database container, tenant server

**phpMyAdmin**:
Klien browser tunggal untuk seluruh node (`stealth-pma`, alias `pma`) di Platform Domain. Setiap Database MySQL masuk lewat alamat yang sama dengan kredensialnya sendiri.
_Avoid_: PMA, sidecar

**Public Database Proxy**:
Endpoint TCP yang dulu membuka akses ke satu Database dari luar. Sudah dihapus untuk semua engine: satu listener pada server bersama akan mempublikasikan seluruh tenant, jadi permintaannya dijawab `409 database_proxy_unsupported`. Akses dari luar hanya lewat Service di Project yang sama.
_Avoid_: Public DB, open port

### Addressing

**Platform Subdomain**:
Alamat default sebuah Service di bawah domain platform; untuk percobaan menggunakan nip.io.
_Avoid_: Free domain, subdomain

**Custom Domain**:
Domain milik user yang diarahkan ke sebuah Service.
_Avoid_: Vanity domain, own domain

### Operations

**Control Plane**:
Proses yang menjalankan dashboard, API, autentikasi, dan data platform; tidak menjalankan container user.
_Avoid_: Panel, backend

**Node Agent**:
Proses di hosting node yang menjalankan container, Build, routing, log, dan operasi Docker atas perintah Control Plane.
_Avoid_: Runner, daemon

**Node Agent seam**:
Satu module (`lib/platform/node-agent.ts`) yang menjadi satu-satunya jalan Control Plane mencapai Node Agent: ia memiliki konstruksi client, kebijakan status 404/409/502, dan kosakata kegagalannya, sehingga module lain memanggil operasi bernama, bukan verb dan path. Sengaja tanpa port yang bisa diinjeksi — adapter HTTP adalah satu-satunya adapter, dan tes API memakai fake server HTTP sungguhan, jadi seam ini nyata karena locality, bukan karena dua adapter.
_Avoid_: Agent client, agent service, transport layer

**Quota**:
Batas resource yang berlaku untuk sebuah Organization.
_Avoid_: Limit, plan

**Email provider**:
Layanan eksternal (Resend atau Mailjet) yang mengirim email transaksional platform. Kredensialnya disimpan terenkrip dan diatur oleh Platform Admin di Admin Console; satu provider menjadi primary dan yang lain fallback saat kuota habis.
_Avoid_: SMTP server, mailserver

**Backup**:
Salinan file Volume atau Database pada satu titik waktu.
_Avoid_: Snapshot, dump

**Suspension**:
Tindakan Platform Admin yang menghentikan Service atau Organization karena abuse.
_Avoid_: Ban, disable

**Abuse Report**:
Laporan dari publik tentang konten atau perilaku Service yang melanggar aturan platform.
_Avoid_: Complaint, ticket
