---
status: superseded by ADR-0006
---

# Satu cluster MySQL bersama untuk database user

Database yang dijual ke user berjalan di satu cluster MySQL bersama. Setiap Project mendapat satu Database dan satu Database User dengan grant terbatas, alih-alih container atau instance MySQL sendiri. Ini menekan biaya dan mempercepat provisioning; konsekuensinya isolasi bersifat logis, ada risiko noisy neighbor, dan backup/restore harus per database.
