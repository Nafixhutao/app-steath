# 20: GC image dan network project saat menghapus Service/Project

**What to build:** Menghapus sebuah Service lewat dashboard menghapus container
dan volume-nya, tetapi **tidak** menghapus image yang pernah dibuild dari Service
itu, dan menghapus Project tidak menghapus network per-project. Akibatnya disk dan
namespace Docker menumpuk meski resource sudah dihapus dari database.

**Blocked by:** 08 (cleanup), 04 (siklus hidup project)

**Status:** needs-triage

- [ ] Hapus Service membership dari image `stealth/service-<serviceId>:*` dan
      network per-project bila sudah tidak dipakai.
- [ ] Hapus Project melepas Caddy dari network project (`docker network
      disconnect`), lalu menghapus network `stealth-project-<projectId>`.
- [ ] Perilaku sama pada cancel/abort yang sudah meninggalkan image yatim.

## Findings (dari smoke test ticket 19)

Setelah signup → project `E2E Demo` → service `web` (repo
`docker/welcome-to-docker`) → deploy `running` → delete semua resource lewat UI,
tabel database sudah nol dan route Caddy `[]`, tetapi yang tersisa di Docker:

1. **2 image service tidak terhapus**: `stealth/service-<serviceId>:0f14c...`
   dan `:1e8d2f...`. `agent/internal/runtime/manager.go` `Remove` (~baris 770)
   hanya `StopContainer` + `RemoveContainer` + hapus Volume. Ia memanggil
   `DeleteRoute`/`removeRoutesForUpstream`, tetapi tidak pernah memanggil
   `PruneImages` untuk repository itu.
2. **1 network project tidak terhapus**: `stealth-project-<projectId>` masih
   ada dengan endpoint `stealth-caddy` terpasang. `Remove` tidak menghapus
   network, dan Caddy tidak di-`disconnect` dari network project (seperti kode
   hapus di VPS tadi: `docker network disconnect` + `rm` manual yang
   membereskannya).

Keduanya tidak diklaim oleh job berkala apa pun; hanya kebetulan scope
housekeeping-startup yang menyentuh image build-cache, bukan image service
aktif yang usianya di bawah ambang retensi.

## Catatan

- `Manager.Remove` (agent) adalah satu-satunya pihak yang tahu nama container,
  image, dan network deterministik — jadi perbaikannya harus ada di agent,
  bukan di Control Plane.
- Hati-hati: `RemoveService` tidak boleh menghapus image yang masih dirujuk
  container lain (mis. service yang di-stop tapi masih bisa di-start), dan
  network project hanya boleh dihapus bila seluruh service/database di
  project itu sudah dibongkar.