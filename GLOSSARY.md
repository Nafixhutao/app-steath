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
User dengan akses lintas Organization untuk menangani abuse, Suspension, dan operasi platform.
_Avoid_: Superadmin, root

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

**Environment Variable**:
Nilai konfigurasi yang disuntikkan ke Service saat runtime.
_Avoid_: Env, config

**Database**:
Database PostgreSQL yang disediakan platform untuk sebuah Project; paling banyak satu per Project.
_Avoid_: DB, schema

**Public Database Proxy**:
Endpoint TCP opsional yang membuka akses ke Database dari luar dengan allowlist.
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

**Quota**:
Batas resource yang berlaku untuk sebuah Organization.
_Avoid_: Limit, plan

**Backup**:
Salinan file Volume atau Database pada satu titik waktu.
_Avoid_: Snapshot, dump

**Suspension**:
Tindakan Platform Admin yang menghentikan Service atau Organization karena abuse.
_Avoid_: Ban, disable

**Abuse Report**:
Laporan dari publik tentang konten atau perilaku Service yang melanggar aturan platform.
_Avoid_: Complaint, ticket
