# Spec: PaaS Experiment

Status: ready-for-agent

## Problem Statement

Developer dan UMKM yang ingin menjalankan aplikasi web beserta PostgreSQL harus mengurus VPS, Docker, TLS, database, backup, dan keamanan sendiri. Shared hosting tidak cocok untuk aplikasi modern berbasis container, sedangkan PaaS besar terasa mahal dan sulit dikendalikan.

Untuk percobaan ini, kami ingin membuktikan bahwa satu VPS cukup untuk menjalankan platform ala Railway: user menghubungkan repository publik, platform melakukan Build dari Dockerfile, menjalankan Service, memberikan URL HTTPS, menyediakan Database, serta menegakkan Quota, Backup, dan kontrol abuse.

## Solution

Bangun platform dengan dua proses yang terpisah secara logis:

- **Control Plane** menjalankan dashboard, API, autentikasi, data Organization/Project/Service, dan worker Deployment. Control Plane tidak memiliki akses ke Docker socket.
- **Node Agent** berjalan di hosting node dan menjadi satu-satunya komponen yang berbicara ke Docker, BuildKit, Caddy, dan TCP proxy.

User membuat Organization, Project, lalu Service dari repository publik. Setiap Deployment membangun image dari Dockerfile, menjalankan container dengan resource limit dan network per Project, lalu merutekan Platform Subdomain atau Custom Domain melalui Caddy. Database PostgreSQL dapat dibuat satu per Project dan diakses Service lewat jaringan privat; akses dari internet hanya tersedia lewat Public Database Proxy opt-in dengan allowlist.

Percobaan ini sengaja dibatasi pada satu VPS, satu Node Agent, web Service, environment production, repository publik, dan deploy manual. Platform belum menjadi layanan produksi: belum ada billing, multi-node, preview environment, worker, cron, private repository, atau email transaksional.

## User Stories

### Akun dan Organization

1. Sebagai visitor, saya ingin mendaftar dengan email dan password, supaya saya bisa mulai memakai platform.
2. Sebagai User, saya ingin masuk dan keluar, supaya akses ke akun saya aman.
3. Sebagai User, saya ingin sesi saya bertahan saat browser dibuka kembali, supaya saya tidak perlu login terus-menerus.
4. Sebagai User, saya ingin memiliki username, supaya identitas saya mudah dikenali anggota lain.
5. Sebagai User baru, saya ingin otomatis mendapatkan satu Organization pribadi, supaya saya bisa langsung membuat Project tanpa langkah tambahan.
6. Sebagai User, saya ingin membuat Organization tambahan, supaya saya bisa memisahkan pekerjaan pribadi dan tim.
7. Sebagai User, saya ingin berpindah Organization aktif, supaya Project dan Quota yang terlihat sesuai konteks.
8. Sebagai Organization owner, saya ingin mengundang anggota lewat tautan yang bisa saya salin, supaya saya bisa menambah anggota tanpa bergantung pada email.
9. Sebagai User yang diundang, saya ingin menerima undangan dan bergabung ke Organization, supaya saya bisa berkolaborasi.
10. Sebagai owner atau admin, saya ingin mengubah Role anggota, supaya izin sesuai tanggung jawabnya.
11. Sebagai owner, saya ingin mengeluarkan anggota, supaya akses yang tidak lagi diperlukan bisa dicabut.
12. Sebagai Member, saya ingin keluar dari Organization, supaya saya bisa berhenti berkolaborasi.
13. Sebagai owner, saya ingin mengganti nama Organization, supaya nama tetap relevan.
14. Sebagai owner, saya ingin menghapus Organization dengan konfirmasi teks, supaya saya bisa menghapus seluruh resource secara sadar.
15. Sebagai User, saya ingin Organization aktif diingat, supaya saya kembali ke konteks yang sama saat login berikutnya.
16. Sebagai User tanpa izin, saya ingin mendapat pesan penolakan yang jelas, supaya saya tahu tindakan apa yang tidak diizinkan.

### Project

17. Sebagai owner atau admin, saya ingin membuat Project di dalam Organization, supaya Service dan Database bisa dikelompokkan.
18. Sebagai anggota Organization, saya ingin melihat daftar Project beserta status ringkasnya, supaya saya tahu kondisi aplikasi.
19. Sebagai anggota Organization, saya ingin membuka halaman Project yang menampilkan Service dan Database, supaya saya bisa mengelola satu aplikasi dari satu tempat.
20. Sebagai owner atau admin, saya ingin mengganti nama dan slug Project, supaya penamaan tetap rapi.
21. Sebagai owner atau admin, saya ingin menghapus Project dengan konfirmasi, supaya seluruh Service, Database, Volume, dan Domain di dalamnya ikut dibersihkan.
22. Sebagai anggota Organization, saya ingin melihat pemakaian Quota di level Organization dan Project, supaya saya tahu sisa kapasitas.
23. Sebagai owner atau admin, saya ingin ditolak dengan pesan yang jelas saat membuat Project melebihi Quota, supaya saya tidak mengira platform rusak.

### Service

24. Sebagai owner atau admin, saya ingin membuat Service dari URL repository publik, supaya platform bisa membangun aplikasi saya.
25. Sebagai owner atau admin, saya ingin menentukan branch repository, supaya Deployment memakai kode yang benar.
26. Sebagai owner atau admin, saya ingin menentukan lokasi Dockerfile, supaya aplikasi dengan struktur repository khusus tetap bisa dibangun.
27. Sebagai owner atau admin, saya ingin menentukan port container, supaya platform tahu ke port mana traffic diteruskan.
28. Sebagai owner atau admin, saya ingin menentukan health check path, supaya Deployment hanya dianggap berhasil jika aplikasi benar-benar siap.
29. Sebagai anggota Organization, saya ingin melihat detail Service beserta URL dan status terakhir, supaya saya tahu cara mengaksesnya.
30. Sebagai anggota Organization, saya ingin melihat batas CPU, RAM, Volume, dan storage Database, supaya saya memahami resource yang tersedia.
31. Sebagai owner atau admin, saya ingin memicu Deployment manual, supaya perubahan pada branch yang dipilih bisa dirilis.
32. Sebagai anggota Organization, saya ingin melihat status Deployment secara langsung, supaya saya tahu apakah Build atau Deploy sedang berjalan.
33. Sebagai anggota Organization, saya ingin membaca log Build, supaya saya bisa memperbaiki Dockerfile atau dependency yang gagal.
34. Sebagai anggota Organization, saya ingin membaca log runtime Service, supaya saya bisa mendiagnosis error aplikasi.
35. Sebagai anggota Organization, saya ingin log dibatasi pada Service milik Organization saya, supaya data Organization lain tidak bocor.
36. Sebagai owner atau admin, saya ingin melakukan redeploy pada commit yang sama, supaya saya bisa memulihkan container yang bermasalah.
37. Sebagai owner atau admin, saya ingin membatalkan Deployment yang masih queued atau sedang Build, supaya saya tidak membuang resource.
38. Sebagai owner atau admin, saya ingin menghentikan Service, supaya aplikasi berhenti memakai resource tanpa dihapus.
39. Sebagai owner atau admin, saya ingin menyalakan kembali Service yang berhenti, supaya aplikasi bisa diakses lagi.
40. Sebagai owner atau admin, saya ingin me-restart Service, supaya container dijalankan ulang tanpa mengubah konfigurasi.
41. Sebagai owner atau admin, saya ingin menghapus Service dengan konfirmasi, supaya container, Volume, Domain, dan data terkait dibersihkan.
42. Sebagai owner atau admin, saya ingin ditolak saat membuat Service melebihi dua per Project atau lima per Organization, supaya Quota tidak dilanggar.
43. Sebagai anggota Organization, saya ingin daftar Service menampilkan status running, stopped, deploying, failed, atau suspended, supaya kondisi aplikasi mudah dipahami.
44. Sebagai visitor, saya ingin Service yang suspended menampilkan halaman 503 yang jelas, supaya saya tahu layanan sedang tidak tersedia.
45. Sebagai anggota Organization, saya ingin melihat commit SHA yang sedang berjalan, supaya saya tahu versi kode yang aktif.
46. Sebagai anggota Organization, saya ingin melihat waktu Deployment terakhir, supaya saya bisa melacak perubahan.
47. Sebagai anggota Organization, saya ingin melihat alasan kegagalan Deployment, supaya saya tidak perlu menebak.
48. Sebagai owner atau admin, saya ingin URL Service hanya aktif setelah health check berhasil, supaya traffic tidak diarahkan ke aplikasi yang belum siap.
49. Sebagai owner atau admin, saya ingin Service otomatis menerima `DATABASE_URL` ketika Project memiliki Database, supaya aplikasi bisa langsung terhubung.
50. Sebagai owner atau admin, saya ingin perubahan konfigurasi Service menandai perlunya redeploy, supaya saya tahu perubahan belum aktif.

### Deployment

51. Sebagai anggota Organization, saya ingin melihat riwayat Deployment, supaya saya bisa melacak versi dan hasilnya.
52. Sebagai anggota Organization, saya ingin setiap Deployment memiliki status yang jelas: queued, building, deploying, running, failed, atau cancelled.
53. Sebagai anggota Organization, saya ingin log Build tersedia selama tujuh hari, supaya saya bisa menyelidiki masalah baru-baru ini.
54. Sebagai anggota Organization, saya ingin log runtime tersedia selama tujuh hari, supaya saya bisa menyelidiki error baru-baru ini.
55. Sebagai owner atau admin, saya ingin hanya satu Build berjalan pada satu waktu, supaya Build tidak menghabiskan CPU dan RAM VPS.
56. Sebagai anggota Organization, saya ingin Deployment lain tetap queued saat Build lain berjalan, supaya urutan kerja jelas.
57. Sebagai owner atau admin, saya ingin Deployment yang gagal pada tahap Build tidak menghentikan versi lama, supaya aplikasi tetap hidup.
58. Sebagai owner atau admin, saya ingin Deployment yang gagal pada health check tidak menggantikan versi lama, supaya traffic tetap aman.
59. Sebagai owner atau admin, saya ingin Deployment yang berhasil memindahkan traffic ke container baru lalu menghentikan container lama, supaya rilis berjalan dengan downtime minimal.
60. Sebagai anggota Organization, saya ingin melihat waktu mulai, waktu selesai, dan durasi Deployment, supaya saya bisa menilai performa rilis.
61. Sebagai owner atau admin, saya ingin Deployment yang dibatalkan tidak meninggalkan container atau image sampah, supaya resource tidak bocor.
62. Sebagai anggota Organization, saya ingin image lama dibersihkan secara otomatis, supaya disk VPS tidak cepat penuh.

### Environment Variable dan Volume

63. Sebagai owner atau admin, saya ingin menambah Environment Variable ke Service, supaya aplikasi bisa dikonfigurasi tanpa mengubah image.
64. Sebagai owner atau admin, saya ingin nilai rahasia ditampilkan dalam bentuk tersamar, supaya secret tidak terlihat tanpa sengaja.
65. Sebagai owner atau admin, saya ingin mengubah dan menghapus Environment Variable, supaya konfigurasi bisa diperbarui.
66. Sebagai owner atau admin, saya ingin perubahan Environment Variable memerlukan redeploy, supaya saya tahu kapan nilainya benar-benar dipakai.
67. Sebagai owner atau admin, saya ingin setiap Service memiliki paling banyak satu Volume, supaya data persisten tidak tersebar.
68. Sebagai owner atau admin, saya ingin menentukan mount path dan ukuran Volume, supaya aplikasi bisa menyimpan data di lokasi yang benar.
69. Sebagai anggota Organization, saya ingin data Volume bertahan saat Service di-restart atau di-redeploy, supaya upload dan state aplikasi tidak hilang.
70. Sebagai anggota Organization, saya ingin melihat pemakaian Volume, supaya saya tahu sisa kapasitas.
71. Sebagai owner atau admin, saya ingin Volume ikut terhapus saat Service dihapus setelah konfirmasi, supaya tidak ada data yatim.
72. Sebagai anggota Organization, saya ingin Volume ikut masuk ke Backup harian, supaya data file bisa dipulihkan.

### Database

73. Sebagai owner atau admin, saya ingin menambahkan satu Database PostgreSQL ke Project, supaya aplikasi punya penyimpanan data.
74. Sebagai anggota Organization, saya ingin melihat connection string privat, supaya saya bisa mengonfigurasi aplikasi.
75. Sebagai owner atau admin, saya ingin Service di Project yang sama bisa terhubung ke Database lewat hostname internal, supaya koneksi tidak melewati internet.
76. Sebagai owner atau admin, saya ingin `DATABASE_URL` otomatis tersedia di Service, supaya integrasi tidak perlu setup manual.
77. Sebagai owner atau admin, saya ingin merotasi kredensial Database, supaya password lama tidak berlaku lagi.
78. Sebagai owner atau admin, saya ingin mengaktifkan Public Database Proxy secara opsional, supaya saya bisa terhubung dari laptop.
79. Sebagai owner atau admin, saya ingin mengatur allowlist CIDR untuk Public Database Proxy, supaya hanya IP yang saya izinkan bisa terhubung.
80. Sebagai owner atau admin, saya ingin melihat connection string publik saat proxy aktif, supaya saya bisa memakai TablePlus atau `psql`.
81. Sebagai owner atau admin, saya ingin menonaktifkan Public Database Proxy, supaya endpoint publik segera dicabut.
82. Sebagai anggota Organization, saya ingin Database tidak dapat diakses dari internet secara default, supaya data aman.
83. Sebagai owner atau admin, saya ingin ditolak saat Database melebihi storage 1 GB, supaya Quota ditegakkan.
84. Sebagai owner atau admin, saya ingin menghapus Database dengan konfirmasi, supaya data tidak hilang tanpa sengaja.
85. Sebagai anggota Organization, saya ingin melihat status kesehatan Database, supaya saya tahu jika container bermasalah.
86. Sebagai anggota Organization, saya ingin Database memakai PostgreSQL 16, supaya versi engine konsisten.
87. Sebagai owner atau admin, saya ingin Database otomatis masuk ke Backup harian, supaya data bisa dipulihkan.
88. Sebagai owner atau admin, saya ingin memulihkan Database dari Backup, supaya saya bisa kembali ke titik waktu sebelumnya.

### Domain dan TLS

89. Sebagai anggota Organization, saya ingin setiap Service otomatis mendapat Platform Subdomain, supaya aplikasi langsung bisa diakses.
90. Sebagai anggota Organization, saya ingin Platform Subdomain memakai HTTPS otomatis, supaya traffic terenkripsi.
91. Sebagai owner atau admin, saya ingin menambahkan satu Custom Domain ke Service, supaya aplikasi memakai domain milik saya.
92. Sebagai owner atau admin, saya ingin melihat instruksi DNS yang jelas, supaya saya bisa mengarahkan domain ke platform.
93. Sebagai owner atau admin, saya ingin platform memverifikasi kepemilikan domain, supaya orang lain tidak bisa mengklaim domain saya.
94. Sebagai owner atau admin, saya ingin melihat status verifikasi dan sertifikat, supaya saya tahu apakah domain sudah aktif.
95. Sebagai visitor, saya ingin mengakses Service lewat Custom Domain dengan HTTPS, supaya pengalaman pengguna normal.
96. Sebagai owner atau admin, saya ingin menghapus Custom Domain, supaya domain tidak lagi diarahkan ke Service.
97. Sebagai owner atau admin, saya ingin ditolak saat memakai hostname yang sudah dipakai Service lain, supaya tidak ada konflik routing.
98. Sebagai anggota Organization, saya ingin Platform Subdomain tetap berfungsi walaupun Custom Domain gagal diverifikasi, supaya aplikasi tidak ikut mati.
99. Sebagai Platform Admin, saya ingin Caddy hanya menerbitkan sertifikat untuk hostname yang terdaftar, supaya platform tidak disalahgunakan untuk certificate abuse.

### Backup

100. Sebagai owner atau admin, saya ingin Backup harian otomatis untuk Database dan Volume, supaya data tidak hilang jika terjadi kesalahan.
101. Sebagai anggota Organization, saya ingin melihat daftar Backup beserta waktu dan ukurannya, supaya saya tahu titik pemulihan yang tersedia.
102. Sebagai anggota Organization, saya ingin Backup disimpan selama tujuh hari, supaya saya punya jendela pemulihan yang cukup.
103. Sebagai owner atau admin, saya ingin memulihkan Database dari Backup, supaya saya bisa memperbaiki data yang rusak.
104. Sebagai owner atau admin, saya ingin memulihkan Volume dari Backup, supaya file aplikasi bisa kembali.
105. Sebagai owner atau admin, saya ingin konfirmasi dan peringatan downtime sebelum restore, supaya saya siap dengan dampaknya.
106. Sebagai anggota Organization, saya ingin melihat status Backup yang gagal, supaya saya bisa bertindak sebelum kehilangan data.
107. Sebagai owner atau admin, saya ingin Backup diunggah ke penyimpanan S3-compatible, supaya Backup tidak hilang bersama VPS.
108. Sebagai owner atau admin, saya ingin peringatan jelas jika Backup hanya tersimpan lokal, supaya saya tahu risikonya.
109. Sebagai Platform Admin, saya ingin setiap restore tercatat di audit, supaya tindakan sensitif bisa ditelusuri.
110. Sebagai Platform Admin, saya ingin database platform ikut di-Backup, supaya data Control Plane bisa dipulihkan.

### Quota

111. Sebagai anggota Organization, saya ingin melihat ringkasan Quota Organization, supaya saya tahu batas Project, Service, Database, CPU, RAM, dan storage.
112. Sebagai owner atau admin, saya ingin pembuatan Project ditolak setelah tiga Project, supaya Quota Organization ditegakkan.
113. Sebagai owner atau admin, saya ingin pembuatan Service ditolak setelah dua Service per Project atau lima Service per Organization, supaya Quota ditegakkan.
114. Sebagai owner atau admin, saya ingin pembuatan Database ditolak setelah satu Database per Project, supaya Quota ditegakkan.
115. Sebagai anggota Organization, saya ingin setiap Service dibatasi 0,5 vCPU dan 512 MB RAM, supaya satu Service tidak menghabiskan VPS.
116. Sebagai anggota Organization, saya ingin setiap Volume dibatasi 1 GB dan setiap Database dibatasi 1 GB, supaya disk VPS terkendali.
117. Sebagai owner atau admin, saya ingin hanya satu Build berjalan pada satu waktu di node, supaya Build tidak saling berebut resource.
118. Sebagai anggota Organization, saya ingin log disimpan maksimal tujuh hari, supaya disk tidak penuh.
119. Sebagai owner atau admin, saya ingin pesan error Quota menyebut batas dan pemakaian saat ini, supaya saya tahu apa yang harus dihapus.
120. Sebagai Platform Admin, saya ingin melihat pemakaian Quota setiap Organization, supaya saya bisa menangani penyalahgunaan atau permintaan peningkatan.

### Abuse dan Administrasi

121. Sebagai Platform Admin, saya ingin setiap image hasil Build dipindai otomatis, supaya risiko malware dan vulnerability bisa dideteksi.
122. Sebagai Platform Admin, saya ingin melihat temuan pemindaian per Deployment, supaya saya bisa menilai risiko sebelum mengambil tindakan.
123. Sebagai visitor, saya ingin melaporkan Service yang melanggar aturan lewat formulir publik, supaya saya bisa membantu menjaga platform.
124. Sebagai Platform Admin, saya ingin melihat antrean Abuse Report, supaya laporan bisa ditindaklanjuti.
125. Sebagai Platform Admin, saya ingin menangguhkan satu Service, supaya konten bermasalah berhenti diakses tanpa menghapus data.
126. Sebagai Platform Admin, saya ingin menangguhkan seluruh Organization, supaya semua Service bermasalah berhenti sekaligus.
127. Sebagai Platform Admin, saya ingin membatalkan Suspension, supaya layanan bisa pulih setelah masalah selesai.
128. Sebagai visitor, saya ingin melihat halaman 503 saat Service suspended, supaya saya tahu layanan tidak tersedia.
129. Sebagai Platform Admin, saya ingin setiap tindakan admin tercatat di audit, supaya penyalahgunaan wewenang bisa ditelusuri.
130. Sebagai Platform Admin, saya ingin mencari Organization dan Service lintas tenant, supaya saya bisa menangani laporan dengan cepat.
131. Sebagai Platform Admin, saya ingin melihat detail Deployment dan log yang relevan, supaya saya bisa mendiagnosis laporan abuse.
132. Sebagai Platform Admin, saya ingin tidak bisa melihat nilai Environment Variable rahasia, supaya privasi user tetap terjaga.
133. Sebagai Platform Admin, saya ingin rate limit pada signup, deploy, dan Abuse Report, supaya platform tidak mudah dibanjiri request.
134. Sebagai Platform Admin, saya ingin melihat Service yang berjalan di Node Agent beserta labelnya, supaya saya bisa memverifikasi kondisi node.

### Operasional

135. Sebagai operator platform, saya ingin Control Plane dan Node Agent memiliki health endpoint, supaya saya bisa memantau proses utama.
136. Sebagai operator platform, saya ingin Node Agent mengirim heartbeat, supaya status node terlihat di Control Plane.
137. Sebagai operator platform, saya ingin Deployment yang queued tetap diproses setelah worker restart, supaya pekerjaan tidak hilang.
138. Sebagai operator platform, saya ingin restart Control Plane tidak menghentikan Service user, supaya panel dan aplikasi tidak saling bergantung saat runtime.
139. Sebagai operator platform, saya ingin Node Agent merekonsiliasi container dan route saat restart, supaya Service yang sudah ada tetap dikenali.
140. Sebagai operator platform, saya ingin Backup tetap berjalan terjadwal, supaya RPO tetap terjaga.
141. Sebagai operator platform, saya ingin image, container, log, dan Volume yatim dibersihkan, supaya disk VPS tidak penuh.
142. Sebagai operator platform, saya ingin menghapus seluruh data Organization saat Organization dihapus, supaya tidak ada data tersisa.
143. Sebagai operator platform, saya ingin menjalankan seluruh sistem pada satu VPS, supaya percobaan ini realistis dan murah.

## Implementation Decisions

### Arsitektur

- Percobaan berjalan pada satu VPS, tetapi Control Plane dan Node Agent adalah proses terpisah. Control Plane tidak memegang Docker socket; hanya Node Agent yang melakukannya.
- Control Plane terdiri dari aplikasi Next.js untuk dashboard, API, dan autentikasi, ditambah worker Deployment yang berjalan sebagai proses terpisah dari codebase yang sama.
- Node Agent adalah service HTTP versioned yang ditulis dalam Go dan didistribusikan sebagai single binary. Node Agent mengelola Docker Engine, BuildKit, Caddy admin API, TCP proxy, log, dan operasi Backup.
- Control Plane dan worker tetap TypeScript/Next.js. Kontrak Control Plane ke Node Agent didefinisikan sebagai OpenAPI/JSON Schema; client TypeScript dan server stub Go di-generate dari kontrak tersebut agar tipe tidak melenceng.
- Caddy berada di depan sebagai reverse proxy dan TLS terminator. Caddy merutekan dashboard/API ke Control Plane dan Service user ke container masing-masing.
- PostgreSQL platform menyimpan data Control Plane dan Better Auth. Database user berjalan sebagai container PostgreSQL terpisah per Project dan tidak memakai instance platform.
- Backup memakai penyimpanan S3-compatible. Jika kredensial tidak tersedia, sistem memakai disk lokal dan menampilkan peringatan bahwa Backup tidak tahan kehilangan VPS.
- Komunikasi Control Plane ke Node Agent memakai HTTP privat dengan bearer token. Node Agent tidak diekspos ke internet dan tidak dirutekan oleh Caddy.
- Semua pekerjaan Build, Deploy, Backup, dan Restore dicatat sebagai job di PostgreSQL platform dan diproses worker. Worker mengklaim job dengan `FOR UPDATE SKIP LOCKED`.
- Build concurrency global adalah satu per node pada percobaan ini. Deployment lain queued.
- Node Agent menyimpan state operasional di Docker label dan file kerja lokal; Control Plane tetap menjadi sumber kebenaran metadata.

### Model Domain dan Skema

Gunakan Better Auth organization plugin untuk `organization`, `member`, `invitation`, dan session aktif. Jangan membangun sistem tenant sendiri. Platform menambahkan entitas berikut:

- **Project**: `id`, `organizationId`, `name`, `slug`, `createdAt`, `updatedAt`. Unik pada kombinasi Organization dan slug. Maksimal tiga per Organization.
- **Service**: `id`, `projectId`, `name`, `slug`, `repoUrl`, `branch`, `dockerfilePath`, `containerPort`, `healthPath`, `status`, `platformHostname`, `cpuLimit`, `memoryLimitMb`, `createdAt`, `updatedAt`. Maksimal dua per Project dan lima per Organization.
- **Deployment**: `id`, `serviceId`, `status`, `commitSha`, `imageRef`, `buildLogKey`, `runtimeLogKey`, `errorMessage`, `createdBy`, `startedAt`, `finishedAt`, `createdAt`. Status: `queued`, `building`, `deploying`, `running`, `failed`, `cancelled`.
- **EnvironmentVariable**: `id`, `serviceId`, `key`, `encryptedValue`, `isSecret`, `createdAt`, `updatedAt`. Unik pada kombinasi Service dan key. Key dengan prefix `STEALTH_` dan key `DATABASE_URL` dicadangkan untuk platform.
- **Volume**: `id`, `serviceId`, `dockerVolumeName`, `mountPath`, `sizeMb`, `createdAt`. Unik per Service.
- **Database**: `id`, `projectId`, `engine`, `version`, `databaseName`, `username`, `encryptedPassword`, `storageLimitMb`, `status`, `publicProxyEnabled`, `publicProxyPort`, `publicProxyHostname`, `createdAt`. Unik per Project.
- **DatabaseProxyAllowlist**: `id`, `databaseId`, `cidr`, `createdAt`.
- **CustomDomain**: `id`, `serviceId`, `hostname`, `verificationToken`, `status`, `verifiedAt`, `certificateStatus`, `createdAt`. Unik global pada hostname. Maksimal satu per Service.
- **Backup**: `id`, `organizationId`, `projectId`, `targetType`, `targetId`, `status`, `storageKey`, `storageProvider`, `sizeBytes`, `errorMessage`, `createdAt`, `expiresAt`. Target type: `database`, `volume`, `platform`.
- **AbuseReport**: `id`, `reporterEmail`, `targetUrl`, `category`, `description`, `status`, `resolutionNote`, `createdAt`, `updatedAt`. Status: `new`, `triaged`, `resolved`, `dismissed`.
- **ScanFinding**: `id`, `deploymentId`, `scanner`, `severity`, `title`, `details`, `createdAt`.
- **AuditEvent**: `id`, `actorUserId`, `organizationId`, `action`, `targetType`, `targetId`, `metadata`, `createdAt`.
- **UsageSnapshot**: `id`, `organizationId`, `projectId`, `serviceId`, `databaseId`, `cpuUsage`, `memoryUsageMb`, `volumeUsageMb`, `databaseUsageMb`, `capturedAt`.
- **Node**: `id`, `name`, `baseUrl`, `tokenHash`, `status`, `lastSeenAt`, `capacity`, `createdAt`. Percobaan hanya memakai satu node.
- **Job**: `id`, `type`, `payload`, `status`, `attempts`, `runAt`, `lockedAt`, `createdAt`, `updatedAt`.

Semua ID memakai UUID. Resource yang dimiliki Organization harus selalu difilter dengan `organizationId` pada query. Penghapusan Project bersifat cascade ke Service, Database, Volume, Custom Domain, Deployment, Environment Variable, dan Backup terkait. AuditEvent dipertahankan 30 hari setelah penghapusan.

### Autentikasi, Organization, dan Izin

- Auth memakai email/password dan username yang sudah ada. Session memakai cookie Better Auth.
- Organization plugin diaktifkan di server dan client. Session menyimpan Organization aktif.
- Saat User baru mendaftar, platform membuat Organization pribadi dan membership owner dalam transaksi yang sama. Nama default diambil dari username dengan suffix yang membuat slug unik.
- Role Organization: `owner`, `admin`, `member`.
- Owner dapat mengelola Organization, anggota, Role, Project, Service, Database, Domain, dan Backup. Admin dapat melakukan hal yang sama kecuali menghapus Organization dan mengubah owner. Member bersifat read-only dan boleh memicu Deployment manual serta melihat log.
- Undangan memakai invitation dari Better Auth organization plugin. Karena email transaksional ditunda, tautan undangan ditampilkan dan dapat disalin. Undangan kedaluwarsa dalam tujuh hari.
- Verifikasi email dan reset password tidak dikirim pada percobaan ini. Risikonya dicatat sebagai batasan, bukan disembunyikan.
- Platform Admin ditentukan oleh daftar email di environment variable. Platform Admin dapat mengakses semua Organization, tetapi tidak dapat melihat nilai Environment Variable rahasia atau password Database.
- Setiap request API harus memeriksa session, keanggotaan Organization, Role, dan kepemilikan resource. Penolakan memakai status 401 untuk belum login, 403 untuk izin kurang, dan 404 untuk resource yang tidak terlihat oleh tenant.

### API Control Plane

- Control Plane menyediakan JSON API yang dipakai dashboard. Semua endpoint kecuali health, signup, signin, invitation acceptance, dan Abuse Report publik memerlukan session.
- Endpoint dikelompokkan per resource: Organization dan anggota, Project, Service, Deployment, Environment Variable, Volume, Database, Public Database Proxy, Custom Domain, Backup, Abuse Report, dan admin.
- Semua request divalidasi dengan schema. Error memakai bentuk `{ error: { code, message, details? } }`; sukses memakai `{ data: ... }`.
- Daftar Deployment dan log memakai pagination berbasis cursor. Status Deployment dan stream log memakai Server-Sent Events.
- Aksi yang mengubah state membuat AuditEvent: membuat/menghapus Project, membuat/menghapus Service, memicu/membatalkan Deployment, mengubah Environment Variable, merotasi kredensial Database, mengaktifkan/menonaktifkan Public Database Proxy, menambah/menghapus Custom Domain, restore Backup, dan semua aksi Platform Admin.
- API menolak perubahan konfigurasi Service saat ada Deployment aktif pada Service yang sama, kecuali pembatalan.
- Rate limit disimpan di PostgreSQL: signup lima per jam per IP, Deployment sepuluh per jam per Organization, Abuse Report tiga per jam per IP, dan percobaan login mengikuti limit Better Auth.
- Health endpoint Control Plane mengembalikan status proses dan konektivitas ke PostgreSQL platform, Node Agent, dan Caddy.

### API Node Agent

- Node Agent ditulis dalam Go. Kontrak OpenAPI/JSON Schema adalah sumber kebenaran untuk request, response, error, dan status; client TypeScript serta server stub Go di-generate dari kontrak yang sama.
- Node Agent memakai bearer token yang di-hash di Control Plane. Token dapat dirotasi.
- Semua endpoint memakai prefix versi dan mengembalikan error terstruktur. Operasi yang menerima ID Deployment harus idempoten.
- Endpoint minimum:
  - Health dan info node.
  - Build: mulai Build, status Build, stream log Build, batalkan Build.
  - Service: deploy image, stop, start, restart, status, log runtime, hapus.
  - Database: buat, hapus, rotasi kredensial, aktifkan/nonaktifkan Public Database Proxy, ubah allowlist, pemakaian storage.
  - Volume: buat, hapus, pemakaian storage.
  - Route: tambah/ubah/hapus route Caddy untuk Platform Subdomain dan Custom Domain.
  - Backup: buat Backup Database/Volume, restore Backup Database/Volume.
  - Pemindaian image.
  - Pemakaian resource node.
- Node Agent memberi label pada semua container, Volume, dan image: Organization, Project, Service, Deployment, dan tipe resource. Rekonsiliasi saat restart memakai label ini.
- Node Agent tidak pernah menerima password Database atau nilai Environment Variable melalui log. Nilai rahasia dikirim di body request dan tidak disimpan di disk Node Agent di luar konfigurasi container.

### Pipeline Deployment

1. User memicu Deployment. Control Plane memvalidasi sesi, Role, Quota, status Service, dan repository URL.
2. Control Plane membuat Deployment berstatus `queued` dan Job. Worker mengklaim Job, mengubah status menjadi `building`, lalu memanggil Node Agent.
3. Node Agent melakukan clone repository publik pada branch dan commit yang diminta, memakai BuildKit untuk membangun image dari Dockerfile, dan memberi tag unik berisi ID Deployment.
4. Build log dialirkan ke Control Plane dan disimpan selama tujuh hari. Jika Build gagal, Deployment menjadi `failed`, versi lama tetap berjalan.
5. Setelah Build berhasil, Node Agent memindai image. Temuan disimpan sebagai ScanFinding. Pemindaian bersifat advisory pada percobaan ini.
6. Node Agent menjalankan container kandidat pada network Project dengan limit resource, Environment Variable, `DATABASE_URL` bila ada, dan Volume. Container kandidat memakai port internal baru.
7. Node Agent melakukan health check selama maksimal 60 detik: port harus terbuka dan health path, jika diisi, harus mengembalikan status 2xx.
8. Jika sehat, Node Agent memperbarui route Caddy ke container kandidat, menghentikan container lama, dan menandai Deployment `running`. Jika tidak sehat, container kandidat dihapus, container lama tetap berjalan, dan Deployment menjadi `failed`.
9. Deployment yang dibatalkan harus menghentikan Build jika memungkinkan, menghapus container kandidat, dan tidak mengubah route.
10. Setelah Deployment sukses, Control Plane menyimpan commit SHA, image reference, dan waktu selesai. Hanya tiga image terakhir per Service yang dipertahankan; sisanya dibersihkan.

### Runtime dan Hardening

- Setiap Service berjalan sebagai satu container pada network bridge khusus Project. Container tidak memakai host network dan tidak mempublikasikan port ke host.
- Limit Service: 0,5 vCPU, 512 MB RAM, 256 PIDs. Root filesystem read-only bila image mendukung; `/tmp` memakai tmpfs; hanya mount path Volume yang writable.
- Container berjalan sebagai non-root, tanpa privileged, tanpa Docker socket, dengan semua capability di-drop, `no-new-privileges`, dan restart policy yang dikelola Node Agent.
- Build berjalan di BuildKit dengan limit resource dan network Build terpisah. Build tidak boleh mengakses network Project atau PostgreSQL platform.
- Environment Variable disimpan terenkripsi AES-256-GCM dengan kunci dari environment. API hanya mengembalikan nilai penuh untuk secret jika user meminta reveal secara eksplisit; dashboard default menampilkan nilai tersamar.
- Log runtime dikumpulkan Node Agent, dirotasi, dan dihapus setelah tujuh hari. Log Build juga dihapus setelah tujuh hari. Nilai Environment Variable tidak boleh muncul di log platform; aplikasi user tetap bertanggung jawab atas lognya sendiri.
- Service yang suspended dihentikan container-nya dan route-nya diarahkan ke halaman 503. Data tidak dihapus.

### Database dan Public Database Proxy

- Database hanya PostgreSQL 16. Setiap Database berjalan sebagai container sendiri dengan Volume sendiri, pada network Project yang sama dengan Service.
- Nama database default `app`, user default `app`, password dibuat acak 32 byte dan disimpan terenkripsi. Tidak ada superuser yang diekspos ke user.
- Hostname internal Database adalah alias network Project, sehingga Service dapat memakai `db:5432` atau connection string yang disediakan platform. `DATABASE_URL` di-inject otomatis dan tidak dapat ditimpa user.
- Database tidak mempublikasikan port ke host secara default. Tidak ada akses dari internet tanpa Public Database Proxy.
- Public Database Proxy adalah opt-in per Database. Saat aktif, Node Agent menjalankan TCP proxy dengan TLS, allowlist CIDR wajib minimal satu entri, dan port unik dari rentang 20000-29999. Hostname memakai platform suffix, misalnya `db-<short-id>.proxy.<platform-suffix>`.
- Proxy menolak koneksi dari IP di luar allowlist dan menolak koneksi tanpa TLS. Menonaktifkan proxy menghentikan listener dan mencabut endpoint.
- Rotasi kredensial mengganti password Database dan memperbarui Environment Variable platform. Service harus di-redeploy agar memakai password baru.
- Storage Database dibatasi 1 GB melalui quota filesystem di Node Agent. Saat penuh, PostgreSQL akan menolak write dan dashboard menandai Database over-quota.

### Routing, Platform Subdomain, dan Custom Domain

- Platform Subdomain dibuat otomatis saat Service dibuat: `<service-slug>-<short-id>.<platform-suffix>`. `short-id` enam karakter acak untuk mencegah tabrakan antar Organization.
- Platform suffix untuk percobaan adalah `<ip-vps>.nip.io`. Caddy menerbitkan sertifikat Let's Encrypt per hostname memakai HTTP-01 on-demand TLS.
- Custom Domain dibatasi satu per Service. User menambahkan hostname, lalu platform menampilkan dua instruksi: TXT record `_stealth-verify.<hostname>` untuk verifikasi kepemilikan dan A/CNAME ke IP VPS.
- Control Plane memverifikasi TXT record dan resolusi A/CNAME sebelum menandai domain `active`. Jika verifikasi gagal, status `failed` dan user dapat mencoba lagi.
- Caddy memakai endpoint `ask` milik Control Plane untuk memastikan hostname terdaftar dan aktif sebelum menerbitkan sertifikat, sehingga platform tidak bisa dipakai menerbitkan sertifikat untuk domain sembarang.
- Semua traffic HTTP dialihkan ke HTTPS. Custom Domain yang belum aktif tidak dirutekan.
- Cloudflare tidak dipakai pada percobaan ini. DNS Custom Domain harus mengarah langsung ke VPS agar HTTP-01 dapat berhasil.

### Backup dan Restore

- Backup berjalan otomatis setiap hari pukul 02.00 UTC untuk setiap Database dan Volume, serta untuk PostgreSQL platform.
- Backup Database memakai `pg_dump` format custom. Backup Volume memakai arsip terkompresi. Backup platform memakai `pg_dump` dan disimpan terenkripsi.
- Backup diunggah ke bucket S3-compatible dengan server-side encryption. Metadata disimpan di Control Plane. Retensi tujuh hari, setelah itu objek dan metadata dihapus.
- Jika kredensial S3 tidak tersedia, Backup disimpan di disk lokal dan dashboard menampilkan peringatan bahwa Backup tidak aman terhadap kehilangan VPS.
- Restore dipicu user dari dashboard dengan konfirmasi teks. Restore Database menghentikan Service di Project terkait, memulihkan Database, lalu menyalakan kembali Service. Restore Volume menghentikan Service pemilik Volume, memulihkan isi Volume, lalu menyalakan kembali Service.
- Restore hanya ke target asal pada percobaan ini. Restore lintas Project atau lintas Organization di luar cakupan.
- Setiap Backup dan Restore memiliki status yang terlihat: `pending`, `running`, `completed`, `failed`. Kegagalan Backup membuat AuditEvent dan peringatan di dashboard.

### Quota

Quota berlaku per Organization dan ditegakkan di API, worker, dan Node Agent:

- Project per Organization: 3
- Service per Project: 2
- Service per Organization: 5
- Database per Project: 1
- vCPU per Service: 0,5
- RAM per Service: 512 MB
- Volume per Service: 1 GB
- Storage Database: 1 GB
- Build bersamaan per node: 1
- Retensi log: 7 hari

- API menolak pembuatan resource yang melewati batas dengan status 409 dan kode error Quota yang menyebut batas serta pemakaian saat ini.
- Node Agent menegakkan limit CPU, RAM, PIDs, Volume, dan storage Database. Worker menegakkan Build concurrency.
- UsageSnapshot diperbarui setiap lima menit dan saat user membuka halaman Quota. Pemakaian CPU/RAM diambil dari Docker stats; pemakaian disk dihitung dari Volume dan Database.
- Bandwidth tidak diukur dan tidak memiliki Quota pada percobaan ini.
- Menurunkan Quota tidak menghapus resource yang sudah ada; resource yang ada tetap berjalan sampai dihapus user.

### Abuse, Pemindaian, dan Administrasi

- Service aktif segera setelah Deployment sukses. Tidak ada review manual sebelum aktif.
- Setiap image hasil Build dipindai dengan Trivy untuk vulnerability, secret, dan misconfiguration, serta ClamAV untuk malware pada filesystem image. Temuan disimpan sebagai ScanFinding dan ditampilkan ke Platform Admin.
- Pemindaian bersifat advisory; temuan tidak otomatis menangguhkan Service. Temuan malware severity tinggi memicu tanda urgent di antrean admin.
- Formulir Abuse Report publik menerima URL target, kategori, deskripsi, dan email pelapor opsional. Formulir memakai rate limit dan captcha sederhana berbasis challenge untuk mengurangi spam.
- Platform Admin memiliki antrean Abuse Report dengan status `new`, `triaged`, `resolved`, `dismissed`.
- Suspension dapat dilakukan pada Service atau Organization. Suspension Service menghentikan container dan menampilkan halaman 503; Suspension Organization menghentikan semua Service di Organization. Data dan Backup tidak dihapus.
- Unsuspend memulihkan Service yang sebelumnya berjalan. Service yang sedang stopped tetap stopped.
- Semua aksi Platform Admin membuat AuditEvent. Platform Admin tidak dapat melihat nilai Environment Variable rahasia atau password Database.
- Platform Admin ditentukan oleh daftar email di environment; tidak ada UI untuk memberikan role Platform Admin pada percobaan ini.

### Siklus Hidup Data dan Operasional

- Menghapus Service menghentikan container, menghapus route, menghapus Volume setelah konfirmasi, menghapus Environment Variable, dan menandai Deployment serta Backup untuk dibersihkan.
- Menghapus Project menghapus semua Service dan Database di dalamnya, termasuk Volume, Custom Domain, dan Backup.
- Menghapus Organization memerlukan konfirmasi teks dan menghapus semua Project, Service, Database, Volume, Domain, dan Backup. AuditEvent dipertahankan 30 hari tanpa secret.
- Image lama dibersihkan setiap Deployment sukses dan setiap hari. Build cache dipangkas mingguan. Container, Volume, dan route yatim dibersihkan berdasarkan label saat Node Agent start.
- Control Plane menjalankan migrasi database dengan advisory lock saat start. Worker dan Node Agent menunggu Control Plane siap.
- Control Plane, worker, Node Agent, Caddy, dan PostgreSQL platform dijalankan sebagai service Docker Compose pada satu VPS. Node Agent memakai Docker socket; ini risiko yang diterima untuk percobaan.
- Node Agent mengirim heartbeat setiap 30 detik. Control Plane menampilkan status node dan memblokir Deployment baru jika node tidak sehat.
- Restart Control Plane tidak menghentikan container Service karena runtime dikelola Node Agent. Restart Node Agent harus merekonsiliasi container dan route yang sudah ada.
- Backup platform PostgreSQL ikut dijadwalkan harian dengan retensi tujuh hari.

## Testing Decisions

### Prinsip

- Tes harus menguji perilaku yang bisa diamati dari luar seam, bukan fungsi privat atau detail implementasi.
- Dua seam utama sudah disepakati:
  1. **API Control Plane** — semua aturan bisnis, auth, Organization, Quota, Deployment orchestration, Database, Domain, Backup, dan abuse diuji lewat HTTP API dengan PostgreSQL asli dan Node Agent palsu.
  2. **API Node Agent** — operasi Docker, Build, runtime, network, Volume, Database, proxy, Caddy, dan Backup diuji langsung dengan Docker asli.
- Satu smoke test end-to-end memakai Control Plane asli dan Node Agent asli untuk membuktikan rantai deploy bekerja.
- Tes tidak boleh bergantung pada urutan eksekusi, waktu tunggu tetap, atau state global. Gunakan polling dengan deadline dan resource unik per tes.
- Jangan menguji teks UI kecuali untuk satu smoke test dashboard. Gunakan kontrak API untuk mayoritas cakupan.

### Control Plane API

Modul yang diuji lewat API:

- Signup, signin, session, dan pembuatan Organization pribadi.
- Isolasi tenant: User dari Organization A tidak bisa membaca atau mengubah Project, Service, Database, Domain, atau Backup Organization B.
- Role: owner, admin, dan member hanya bisa melakukan aksi yang diizinkan.
- Undangan: membuat tautan, menerima undangan, undangan kedaluwarsa, dan anggota yang sudah ada.
- CRUD Project, Service, Environment Variable, Volume, Database, Custom Domain, dan Backup.
- Quota: penolakan Project keempat, Service ketiga dalam satu Project, Service keenam dalam Organization, Database kedua, dan Deployment saat node tidak sehat.
- Environment Variable: nilai tidak dikembalikan dalam bentuk plaintext kecuali reveal, dan nilai terenkripsi tidak muncul di log atau audit.
- Deployment state machine dengan Node Agent palsu: queued → building → deploying → running; kegagalan Build; kegagalan health check; pembatalan; versi lama tetap berjalan saat gagal.
- Database: Public Database Proxy nonaktif secara default, allowlist wajib, rotasi kredensial, dan penolakan akses publik saat proxy mati.
- Custom Domain: verifikasi TXT, konflik hostname, status certificate, dan Platform Subdomain tetap aktif saat Custom Domain gagal.
- Backup: penjadwalan, retensi tujuh hari, fallback lokal, restore memicu stop/start Service, dan audit.
- Abuse: form publik, rate limit, antrean admin, Suspension Service/Organization, halaman 503, dan Unsuspend.
- AuditEvent tercatat untuk aksi sensitif dan tidak memuat secret.

### Node Agent API

Modul yang diuji dengan Docker asli:

- Build dari repository fixture dengan Dockerfile, termasuk Build gagal dan Build log.
- Container dijalankan dengan limit CPU/RAM/PIDs, non-root, read-only rootfs, capability drop, network Project, dan tanpa port host.
- Volume dibuat, dipasang di mount path, data bertahan setelah restart, dan terhapus saat Service dihapus.
- Dua Project tidak bisa saling terhubung ke Database atau Service lewat network.
- Database PostgreSQL dibuat, hanya bisa diakses dari network Project, dan tidak membuka port host.
- Public Database Proxy menolak IP di luar allowlist, menerima IP di allowlist, memakai TLS, dan endpoint hilang setelah dinonaktifkan.
- Route Caddy menambahkan dan menghapus Platform Subdomain serta Custom Domain, dan endpoint `ask` menolak hostname yang tidak terdaftar.
- Log runtime dapat dibaca, dirotasi, dan dihapus setelah retensi.
- Backup Database dan Volume dibuat, diunggah ke target yang dikonfigurasi, dan direstore ke target asal.
- Pemindaian image menghasilkan ScanFinding untuk fixture yang sengaja memakai dependency rentan.
- Rekonsiliasi saat Node Agent restart menemukan container dan route berlabel tanpa menduplikasi.
- Cleanup menghapus container, Volume, image, dan route yatim.
- Kontrak OpenAPI/JSON Schema menghasilkan client TypeScript dan server stub Go yang lolos contract test; perubahan kontrak yang tidak kompatibel harus gagal di CI.

### End-to-End

- Satu smoke test: signup → Organization pribadi → Project → Service dari repository fixture → Deployment → health check → akses Platform Subdomain → buat Database → redeploy dengan `DATABASE_URL` → cek koneksi Database → hapus Project.
- Satu smoke test dashboard: login, buka Project, lihat status Deployment, dan buka log.
- Tes end-to-end memakai VPS/CI dengan Docker dan Caddy. Jika Caddy tidak tersedia di CI, route diuji di Node Agent dan smoke test dijalankan di environment staging.

### Prior Art

Belum ada test suite di repo ini. Spec ini menetapkan pola pertama: Vitest untuk API dan integrasi Control Plane, Go `testing` untuk Node Agent, serta Playwright untuk smoke test dashboard. Karena belum ada prior art, tes harus dibuat kecil, terisolasi, dan mudah dijalankan ulang.

## Out of Scope

- Billing, pembayaran, invoice, dan paket berbayar.
- Private repository, GitHub App, webhook, dan auto-deploy saat push.
- Buildpack/Nixpacks; percobaan hanya Dockerfile.
- Worker, cron, job terjadwal milik user, dan background service.
- Preview environment, staging environment, dan deployment per pull request.
- Multi-node, scheduling lintas node, high availability, dan autoscaling.
- MicroVM, gVisor, Firecracker, dan isolasi tingkat hardware.
- MySQL, MariaDB, Redis, dan engine database lain.
- phpMyAdmin, Adminer, pgAdmin, dan GUI database berbasis web.
- Email transaksional: verifikasi email, reset password, dan pengiriman undangan lewat email.
- Cloudflare for SaaS, custom hostnames, dan edge proxy untuk Custom Domain.
- CDN, edge function, serverless function, dan static site optimization.
- Rollback ke Deployment sebelumnya sebagai aksi satu klik.
- Multi-region, disaster recovery otomatis, dan SLA.
- Metrik terperinci, dashboard observability, dan alerting eksternal.
- API publik untuk customer dan CLI.
- Kuota bandwidth dan pengukuran egress.
- Teams di dalam Organization dan SSO/OAuth.
- Pemulihan Backup lintas Project atau lintas Organization.
- Penghapusan otomatis Service karena temuan pemindaian; Suspension tetap manual.

## Further Notes

- Ini adalah percobaan pada satu VPS. Single point of failure, kapasitas terbatas, dan tidak ada jaminan ketersediaan. Jangan gunakan untuk data produksi penting sebelum ada multi-node, backup teruji, dan hardening tambahan.
- Node Agent memegang Docker socket, yang setara dengan akses root pada host. Ini risiko utama percobaan. Jalur upgrade: rootless Docker, user namespace, gVisor, atau memindahkan Node Agent ke host terpisah.
- nip.io hanya dipakai untuk Platform Subdomain. Custom Domain tetap memerlukan DNS milik user dan akses langsung ke VPS untuk HTTP-01. Cloudflare dapat ditambahkan nanti, tetapi bukan syarat percobaan.
- Email transaksional ditunda. Akibatnya verifikasi email dan reset password belum tersedia, dan undangan memakai tautan yang disalin manual. Ini harus diselesaikan sebelum platform dibuka untuk publik luas.
- ADR yang berlaku: Organization sebagai tenant (ADR-0003), PaaS ala Railway (ADR-0004), Docker sebagai batas isolasi (ADR-0005), PostgreSQL saja (ADR-0006), dan Database private by default dengan Public Database Proxy opt-in (ADR-0007).
- Urutan implementasi yang disarankan: fondasi auth/Organization dan model data; API Project/Service; Node Agent dan pipeline Build/Deploy; routing Caddy; Database dan Public Database Proxy; Quota; Backup; abuse/admin; smoke test end-to-end.
- Definisi selesai untuk percobaan: user dapat mendaftar, membuat Organization/Project/Service, melakukan deploy dari repository publik, mengakses URL HTTPS, membuat Database dan terhubung dari Service, mengaktifkan Public Database Proxy dengan allowlist, menambah Custom Domain, melihat log, memulihkan Backup, dan Platform Admin dapat menangguhkan Service yang melanggar.
